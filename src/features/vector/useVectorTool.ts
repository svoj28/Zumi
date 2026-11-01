import { PaintStyle, Skia, type SkPicture } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import {
  cornerNode,
  deleteNode,
  hitNode,
  hitShape,
  moveAnchor,
  moveHandle,
  newShapeId,
  removeShape,
  reorderShape,
  toggleSmooth,
  translateShape,
  updateShape,
  type NodeHit,
  type VShape,
} from '@/engine/vector/vectorModel';
import { drawShape, shapePath } from '@/engine/vector/vectorRender';
import { useDocumentVersion } from '@/features/editor/useEditorSession';
import { useToolStore } from '@/state/toolStore';

export type VectorMode = 'pen' | 'edit';

/** Touch radius (screen points) for nodes, handles and closing a path. */
const HIT = 22;
/** Dragging further than this (screen points) after placing a node pulls out curve handles. */
const CURVE_DRAG = 6;
const ACCENT = '#ff8a4c';

type Drag =
  | { kind: 'new-node'; index: number; x0: number; y0: number }
  | { kind: 'node'; hit: NodeHit }
  | { kind: 'shape'; x: number; y: number; moved: boolean }
  | null;

/**
 * Pen tool for vector layers.
 *
 * - Pen: tap to place corner nodes, drag to pull out a curve; tap the first node to close the
 *   shape (filled), or "Done" to keep it open (stroked).
 * - Edit: tap a shape to select it; drag its nodes or handles to reshape, drag the shape to move.
 *
 * The shape being drawn or edited is kept here and drawn live in the overlay; the layer's own
 * pixels leave it out meanwhile (`previewVector`). Every finished change is one undo step.
 */
export function useVectorTool(doc: DrawingDocument, active: boolean) {
  useDocumentVersion(doc);
  const layer = doc.layers.active;
  const layerId = layer?.meta.id ?? null;
  const vector = layer?.vector ?? null;

  const [mode, setMode] = useState<VectorMode>('pen');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [draft, setDraft] = useState<VShape | null>(null);
  const [work, setWork] = useState<VShape | null>(null);
  const [fillOn, setFillOn] = useState(true);
  const [strokeOn, setStrokeOn] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(6);
  const drag = useRef<Drag>(null);
  const scale = useRef(1);
  const overlay = useSharedValue<SkPicture>(EMPTY_OVERLAY);

  // A selection that no longer exists (undo, another layer) simply counts as none.
  const selected = vector?.shapes.find((s) => s.id === pickedId) ?? null;
  const selectedId = selected?.id ?? null;
  const shown = draft ?? (work && work.id === selectedId ? work : null) ?? selected;

  // The selected shape is drawn live in the overlay, so the layer leaves it out while the tool
  // is active, and shows everything again when the tool is put away.
  useEffect(() => {
    if (!layerId || !doc.isVectorLayer(layerId)) return;
    doc.previewVector(layerId, active ? selectedId : null);
  }, [active, layerId, selectedId, doc]);

  // Redraw the overlay whenever the live shape changes.
  useEffect(() => {
    overlay.set(recordOverlay(active ? shown : null, draft !== null, selectedNode, scale.current));
  }, [active, shown, draft, selectedNode, overlay]);

  const color = () => useToolStore.getState().color;

  const select = (id: string | null) => {
    setPickedId(id);
    setSelectedNode(null);
    setWork(null);
  };

  /** Commits a changed shape (or a new one) as one undo step. */
  const commit = (shape: VShape, label: string) => {
    if (!layerId || !vector) return;
    const exists = vector.shapes.some((s) => s.id === shape.id);
    const next = exists ? updateShape(vector, shape.id, () => shape) : { shapes: [...vector.shapes, shape] };
    doc.setVector(layerId, next, label);
    if (selectedId === shape.id) doc.previewVector(layerId, shape.id);
  };

  const finishPath = (close: boolean) => {
    if (!draft || draft.nodes.length < 2) {
      setDraft(null);
      return;
    }
    const closed = close && draft.nodes.length > 2;
    const c = color();
    const shape: VShape = {
      ...draft,
      closed,
      fill: closed && fillOn ? c : null,
      // Open paths are always stroked (they would be invisible otherwise).
      stroke: !closed || strokeOn || !fillOn ? c : null,
      strokeWidth,
    };
    setDraft(null);
    commit(shape, closed ? 'Add shape' : 'Add path');
  };

  const onPointer = (phase: 'begin' | 'move' | 'end', x: number, y: number, viewScale: number) => {
    if (!active || !layerId || !vector) return;
    scale.current = viewScale;
    const r = HIT / viewScale;

    if (mode === 'pen') {
      if (phase === 'begin') {
        if (draft && draft.nodes.length > 2 && Math.hypot(draft.nodes[0].x - x, draft.nodes[0].y - y) <= r) {
          finishPath(true);
          drag.current = null;
          return;
        }
        const base: VShape = draft ?? { id: newShapeId(), nodes: [], closed: false, fill: null, stroke: color(), strokeWidth };
        const next = { ...base, nodes: [...base.nodes, cornerNode(x, y)] };
        setDraft(next);
        drag.current = { kind: 'new-node', index: next.nodes.length - 1, x0: x, y0: y };
      } else if (phase === 'move' && drag.current?.kind === 'new-node') {
        const d = drag.current;
        if (Math.hypot(x - d.x0, y - d.y0) * viewScale < CURVE_DRAG) return;
        // Pull out mirrored handles: a smooth curve through the new node.
        setDraft((cur) =>
          cur
            ? { ...cur, nodes: cur.nodes.map((n, i) => (i === d.index ? { ...n, inX: n.x - x, inY: n.y - y, outX: x - n.x, outY: y - n.y } : n)) }
            : cur,
        );
      } else if (phase === 'end') {
        drag.current = null;
      }
      return;
    }

    // ---- edit mode ----
    const current = (work && work.id === selectedId ? work : null) ?? selected;
    if (phase === 'begin') {
      if (current) {
        const hit = hitNode(current, x, y, r);
        if (hit) {
          setSelectedNode(hit.index);
          drag.current = { kind: 'node', hit };
          return;
        }
      }
      const id = hitShape(vector, x, y, r * 0.5);
      if (id !== selectedId) select(id);
      drag.current = id ? { kind: 'shape', x, y, moved: false } : null;
      return;
    }
    const base = (work && work.id === selectedId ? work : null) ?? vector.shapes.find((s) => s.id === pickedId);
    if (!base) return;
    const d = drag.current;
    if (phase === 'move' && d) {
      if (d.kind === 'node') {
        const { index, part } = d.hit;
        setWork(part === 'anchor' ? moveAnchor(base, index, x, y) : moveHandle(base, index, part, x, y, true));
      } else if (d.kind === 'shape') {
        setWork(translateShape(base, x - d.x, y - d.y));
        drag.current = { ...d, x, y, moved: true };
      }
    } else if (phase === 'end') {
      if (work && work.id === selectedId && (d?.kind === 'node' || (d?.kind === 'shape' && d.moved))) {
        commit(work, d.kind === 'shape' ? 'Move shape' : 'Edit shape');
      }
      setWork(null);
      drag.current = null;
    }
  };

  // ---- actions (vector bar) ----------------------------------------------------------------
  const editSelected = (update: (s: VShape) => VShape | null, label: string) => {
    if (!layerId || !vector || !selected) return;
    const next = update(selected);
    if (!next) {
      doc.setVector(layerId, removeShape(vector, selected.id), label);
      select(null);
      return;
    }
    commit(next, label);
  };

  const actions = {
    finishPath: () => finishPath(false),
    closePath: () => finishPath(true),
    cancelPath: () => setDraft(null),
    fillWithColor: () => editSelected((s) => ({ ...s, fill: color(), closed: s.nodes.length > 2 ? true : s.closed }), 'Fill shape'),
    strokeWithColor: () => editSelected((s) => ({ ...s, stroke: color(), strokeWidth: s.strokeWidth || strokeWidth }), 'Stroke shape'),
    removeFill: () => editSelected((s) => ({ ...s, fill: null, stroke: s.stroke ?? color(), strokeWidth: s.strokeWidth || strokeWidth }), 'Remove fill'),
    removeStroke: () => editSelected((s) => ({ ...s, stroke: null, fill: s.fill ?? color() }), 'Remove stroke'),
    setShapeStrokeWidth: (w: number) => {
      setStrokeWidth(w);
      if (selected?.stroke) editSelected((s) => ({ ...s, strokeWidth: w }), 'Stroke width');
    },
    deleteShape: () => editSelected(() => null, 'Delete shape'),
    duplicateShape: () => {
      if (!layerId || !vector || !selected) return;
      const copy = translateShape({ ...selected, id: newShapeId() }, 20 / scale.current, 20 / scale.current);
      doc.setVector(layerId, { shapes: [...vector.shapes, copy] }, 'Duplicate shape');
      select(copy.id);
    },
    reorder: (to: 'up' | 'down' | 'top' | 'bottom') => {
      if (!layerId || !vector || !selected) return;
      doc.setVector(layerId, reorderShape(vector, selected.id, to), 'Arrange shape');
      doc.previewVector(layerId, selected.id);
    },
    toggleNodeSmooth: () => {
      if (selectedNode === null) return;
      editSelected((s) => toggleSmooth(s, selectedNode), 'Smooth / corner');
    },
    deleteNode: () => {
      if (selectedNode === null) return;
      setSelectedNode(null);
      editSelected((s) => deleteNode(s, selectedNode), 'Delete point');
    },
    deselect: () => select(null),
  };

  return {
    overlay: overlay as SharedValue<SkPicture>,
    onPointer,
    mode,
    setMode: (m: VectorMode) => {
      if (m === mode) return;
      if (draft) finishPath(false);
      if (m === 'pen') select(null);
      setMode(m);
    },
    isVectorLayer: !!vector,
    hasDraft: draft !== null && draft.nodes.length > 0,
    selected,
    selectedNode,
    fillOn,
    setFillOn,
    strokeOn,
    setStrokeOn,
    strokeWidth,
    actions,
  };
}

/**
 * Empty overlay. A picture must always come from a recorder that began recording: finishing a
 * recorder that never started yields no picture, and Skia crashes natively when it is used.
 */
const EMPTY_OVERLAY = recordOverlay(null, false, null, 1);

/** Live shape plus its outline, anchors and handles, sized in screen points. */
function recordOverlay(shape: VShape | null, drafting: boolean, selectedNode: number | null, viewScale: number): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(-1e5, -1e5, 2e5, 2e5));
  if (shape && shape.nodes.length > 0) {
    const k = 1 / Math.max(0.01, viewScale);
    drawShape(canvas, shape);
    const line = Skia.Paint();
    line.setAntiAlias(true);
    line.setStyle(PaintStyle.Stroke);
    line.setStrokeWidth(1.5 * k);
    line.setColor(Skia.Color(ACCENT));
    canvas.drawPath(shapePath(shape), line);
    const handleLine = Skia.Paint();
    handleLine.setAntiAlias(true);
    handleLine.setStyle(PaintStyle.Stroke);
    handleLine.setStrokeWidth(1 * k);
    handleLine.setColor(Skia.Color('rgba(255,138,76,0.8)'));
    const fill = Skia.Paint();
    fill.setColor(Skia.Color('#ffffff'));
    const sel = Skia.Paint();
    sel.setColor(Skia.Color(ACCENT));
    shape.nodes.forEach((n, i) => {
      for (const [hx, hy] of [[n.inX, n.inY], [n.outX, n.outY]]) {
        if (!hx && !hy) continue;
        canvas.drawLine(n.x, n.y, n.x + hx, n.y + hy, handleLine);
        canvas.drawCircle(n.x + hx, n.y + hy, 4 * k, fill);
        canvas.drawCircle(n.x + hx, n.y + hy, 4 * k, handleLine);
      }
      const size = (i === 0 && drafting ? 9 : 7) * k;
      const r = Skia.XYWHRect(n.x - size / 2, n.y - size / 2, size, size);
      canvas.drawRect(r, i === selectedNode ? sel : fill);
      canvas.drawRect(r, line);
    });
  }
  return recorder.finishRecordingAsPicture();
}
