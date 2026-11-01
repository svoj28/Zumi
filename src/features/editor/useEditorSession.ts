import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import { useGalleryStore } from '@/state/galleryStore';
import { useSettingsStore } from '@/state/settingsStore';
import {
  beginEditingSession,
  endEditingSession,
  loadDocument,
  saveDocument,
  saveDocumentIncremental,
  touchEditingSession,
  type StoredReference,
} from '@/storage/projectRepository';
import { TimelapseRecorder } from '@/storage/timelapseRepository';
import { describeError, type UserFacingError } from '@/utils/errors';

type SessionState =
  | { status: 'loading' }
  | {
      status: 'ready';
      doc: DrawingDocument;
      warnings: string[];
      references: StoredReference[];
      /** Set when the last session ended unexpectedly: time of the autosave that was reopened. */
      recoveredFrom: number | null;
    }
  | { status: 'error'; error: UserFacingError };

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

/** Quiet period after the last change before an autosave starts. */
const IDLE_MS = 2000;
/** Delay after steps that remove content, so they reach disk almost immediately. */
const DESTRUCTIVE_MS = 300;
/** Retry delay after a failed autosave (e.g. storage full). */
const RETRY_MS = 15000;
/** Timelapse capture: after this quiet period… */
const CAPTURE_IDLE_MS = 800;
/** …or at the latest this long after the first uncaptured change. */
const CAPTURE_MAX_WAIT_MS = 4000;
const DESTRUCTIVE_STEPS = new Set(['Delete layer', 'Clear layer', 'Clear selection', 'Merge down', 'Merge layers', 'Flatten']);

/**
 * Owns the lifetime of an open document: loads it from disk, autosaves it and releases its
 * native memory when the editor closes.
 *
 * Autosave is debounced: a save starts IDLE_MS after the last committed change (never per
 * pointer event), at the latest `autosaveSeconds` after the first unsaved change while the user
 * keeps working, and almost at once after destructive steps. Autosaves are incremental (see
 * saveDocumentIncremental) so drawing is not frozen. Leaving the editor and backgrounding the
 * app save synchronously, since the app may be suspended right after.
 */
export function useEditorSession(projectId: string) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const autosaveSeconds = useSettingsStore((s) => s.autosaveSeconds);
  const recordByDefault = useSettingsStore((s) => s.recordTimelapse);
  const docRef = useRef<DrawingDocument | null>(null);
  const recorderRef = useRef<TimelapseRecorder | null>(null);
  /** Bumped by `retry` to load the project again after a failure. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Defer so the loading UI paints before the (synchronous) decode work starts.
    const timer = setTimeout(() => {
      try {
        const { doc, warnings, references } = loadDocument(projectId);
        if (cancelled) {
          doc.dispose();
          return;
        }
        const recoveredFrom = beginEditingSession(projectId);
        docRef.current = doc;
        setSaveStatus(doc.isDirty ? 'unsaved' : 'saved');
        setState({ status: 'ready', doc, warnings, references, recoveredFrom });
      } catch (error) {
        if (!cancelled) {
          console.error('[editor] Could not open artwork', error);
          setState({ status: 'error', error: describeError(error, 'Can’t open artwork') });
        }
      }
    }, 16);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      const doc = docRef.current;
      docRef.current = null;
      if (!doc) return;
      // Only a successful save makes this a clean exit; otherwise the next open reports recovery.
      if (!doc.isDirty || trySave(doc)) endEditingSession(projectId);
      useGalleryStore.getState().refresh();
      // Give the UI thread a moment to stop drawing this document's images before freeing them.
      setTimeout(() => doc.dispose(), 1000);
    };
  }, [projectId, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const doc = state.status === 'ready' ? state.doc : null;
  // The artwork's own choice wins; artworks without one follow the app-wide setting.
  const artworkRecording = useSyncExternalStore(doc ? doc.subscribe : noSubscription, () => doc?.info.recordTimelapse ?? null);
  const recordTimelapse = artworkRecording ?? recordByDefault;

  /** Synchronous save (explicit "Save now"). */
  const save = useCallback((): boolean => {
    const current = docRef.current;
    if (!current) return false;
    const ok = trySave(current);
    setSaveStatus(ok ? 'saved' : 'error');
    if (ok) touchEditingSession(projectId);
    return ok;
  }, [projectId]);

  // Debounced, incremental autosave.
  useEffect(() => {
    if (!doc) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstUnsavedAt: number | null = null;
    let running = false;
    let disposed = false;

    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), delay);
    };

    const run = async () => {
      timer = null;
      if (disposed || !doc.isDirty) return;
      if (running) {
        schedule(IDLE_MS);
        return;
      }
      running = true;
      setSaveStatus('saving');
      let failed = false;
      try {
        if (await saveDocumentIncremental(doc, () => disposed || docRef.current !== doc)) {
          touchEditingSession(projectId);
        }
      } catch (error) {
        console.error('[editor] Autosave failed', error);
        failed = true;
      } finally {
        running = false;
      }
      if (disposed) return;
      if (failed) {
        setSaveStatus('error');
        schedule(RETRY_MS);
      } else if (doc.isDirty) {
        // Changed while saving, or superseded by another save: go again after a quiet period.
        setSaveStatus('unsaved');
        schedule(IDLE_MS);
      } else {
        firstUnsavedAt = null;
        setSaveStatus('saved');
      }
    };

    const onChange = () => {
      if (!doc.isDirty) return;
      if (!running) setSaveStatus('unsaved');
      if (autosaveSeconds <= 0) return;
      const now = Date.now();
      firstUnsavedAt ??= now;
      const destructive = DESTRUCTIVE_STEPS.has(doc.history.undoLabel ?? '');
      const maxWaitLeft = firstUnsavedAt + autosaveSeconds * 1000 - now;
      schedule(Math.max(0, Math.min(destructive ? DESTRUCTIVE_MS : IDLE_MS, maxWaitLeft)));
    };

    const unsubscribe = doc.subscribe(onChange);
    if (doc.isDirty) onChange();
    return () => {
      disposed = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [doc, autosaveSeconds, projectId]);

  // Timelapse: record what changed shortly after edits settle (never during a stroke). Capturing
  // is cheap — only changed layers' changed rectangles are encoded — and a failed capture never
  // affects editing; the next one records the affected layers in full.
  useEffect(() => {
    if (!doc || !recordTimelapse) return;
    let recorder: TimelapseRecorder;
    try {
      recorder = TimelapseRecorder.open(projectId, doc);
    } catch (error) {
      console.warn('[timelapse] Could not start recording', error);
      return;
    }
    recorderRef.current = recorder;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstPendingAt: number | null = null;

    const capture = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      firstPendingAt = null;
      try {
        recorder.capture();
      } catch (error) {
        console.warn('[timelapse] Capture failed', error);
      }
    };
    const onChange = () => {
      const now = Date.now();
      firstPendingAt ??= now;
      if (timer) clearTimeout(timer);
      timer = setTimeout(capture, Math.max(0, Math.min(CAPTURE_IDLE_MS, firstPendingAt + CAPTURE_MAX_WAIT_MS - now)));
    };
    const unsubscribe = doc.subscribe(onChange);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'background' && timer) capture();
    });
    return () => {
      unsubscribe();
      appState.remove();
      // The document is released a moment after the editor closes, so this still reads it.
      if (timer) capture();
      recorderRef.current = null;
    };
  }, [doc, projectId, recordTimelapse]);

  /** The active timelapse recorder (null while recording is off or unavailable). */
  const getTimelapse = useCallback(() => recorderRef.current, []);

  // Save when the app leaves the foreground — the OS may kill it afterwards. The session marker
  // is cleared once everything is on disk, and restored when the app returns.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const current = docRef.current;
      if (!current) return;
      if (next === 'active') {
        touchEditingSession(projectId);
        return;
      }
      if (next !== 'background') return;
      const ok = !current.isDirty || trySave(current);
      if (ok) endEditingSession(projectId);
      setSaveStatus(ok ? 'saved' : 'error');
    });
    return () => sub.remove();
  }, [projectId]);

  return { state, save, saveStatus, retry, getTimelapse };
}

const noSubscription = () => () => {};

function trySave(doc: DrawingDocument): boolean {
  try {
    saveDocument(doc);
    return true;
  } catch (error) {
    console.error('[editor] Save failed', error);
    return false;
  }
}

/** Re-renders the caller whenever the document commits a change (not during strokes). */
export function useDocumentVersion(doc: DrawingDocument): number {
  return useSyncExternalStore(doc.subscribe, doc.getVersion);
}
