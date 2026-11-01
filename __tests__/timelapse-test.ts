import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import { outputScale, parseState, planPlayback, snapToGrid, TIMELAPSE_FPS } from '@/engine/timelapse/timelapseFormat';
import type { LayerMeta, Rect } from '@/engine/types';
import { loadTimelapse, TimelapseRecorder, timelapseLayers } from '@/storage/timelapseRepository';

// ---- in-memory file system -----------------------------------------------------------------

const mockFiles = new Map<string, string | Uint8Array>();

jest.mock('expo-file-system', () => {
  const join = (parent: { path: string } | string, name?: string) => {
    const base = typeof parent === 'string' ? parent : parent.path;
    return name ? `${base}/${name}` : base;
  };
  class Directory {
    path: string;
    constructor(parent: { path: string } | string, name?: string) {
      this.path = join(parent, name);
    }
    get exists() {
      return [...mockFiles.keys()].some((k) => k.startsWith(`${this.path}/`));
    }
    create() {}
    delete() {
      for (const k of [...mockFiles.keys()]) if (k.startsWith(`${this.path}/`)) mockFiles.delete(k);
    }
  }
  class File {
    path: string;
    constructor(parent: { path: string } | string, name?: string) {
      this.path = join(parent, name);
    }
    get name() {
      return this.path.split('/').pop() ?? '';
    }
    get exists() {
      return mockFiles.has(this.path);
    }
    textSync() {
      return String(mockFiles.get(this.path));
    }
  }
  return { Directory, File };
});

jest.mock('@shopify/react-native-skia', () => ({ ImageFormat: { PNG: 'png' } }));

jest.mock('@/storage/projectRepository', () => {
  const { Directory } = jest.requireMock('expo-file-system') as { Directory: new (p: string, n?: string) => { path: string } };
  return {
    projectDir: (id: string) => new Directory('/projects', id),
    writeFileAtomic: (dir: { path: string }, name: string, bytes: string | Uint8Array) => mockFiles.set(`${dir.path}/${name}`, bytes),
    safeDeleteDir: (dir: { delete: () => void }) => dir.delete(),
  };
});

// ---- fake document ---------------------------------------------------------------------------

class FakeLayer {
  revision = 0;
  private dirty: Rect | null = null;
  constructor(public meta: LayerMeta) {}
  /** Simulates an edit of `rect`. */
  paint(rect: Rect) {
    this.revision += 1;
    const d = this.dirty;
    this.dirty = d
      ? {
          x: Math.min(d.x, rect.x),
          y: Math.min(d.y, rect.y),
          width: Math.max(d.x + d.width, rect.x + rect.width) - Math.min(d.x, rect.x),
          height: Math.max(d.y + d.height, rect.y + rect.height) - Math.min(d.y, rect.y),
        }
      : rect;
  }
  takeDirty() {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }
  readRegion(rect: Rect) {
    // Encoded size proportional to the area, like a PNG of busy pixels.
    return { encodeToBytes: () => new Uint8Array(rect.width * rect.height), dispose: () => {} };
  }
}

function meta(id: string, name: string): LayerMeta {
  return { id, name, visible: true, opacity: 1, blendMode: 'srcOver', locked: false, alphaLocked: false };
}

function fakeDoc(layers: FakeLayer[], width = 1000, height = 800): DrawingDocument {
  return {
    info: { id: 'p_test', name: 'Test', width, height, background: '#ffffff', dpi: 72, createdAt: 0, updatedAt: 0, recordTimelapse: null },
    layers: { list: layers },
  } as unknown as DrawingDocument;
}

beforeEach(() => mockFiles.clear());

describe('TimelapseRecorder', () => {
  it('starts with a keyframe of every layer and the layer stack', () => {
    const recorder = TimelapseRecorder.open('p_test', fakeDoc([new FakeLayer(meta('l_a', 'Sketch')), new FakeLayer(meta('l_b', 'Ink'))]));
    expect(recorder.frameCount).toBe(1);
    const [frame] = loadTimelapse('p_test')!.frames;
    expect(frame.stack?.map((l) => l.id)).toEqual(['l_a', 'l_b']);
    expect(frame.background).toBe('#ffffff');
    expect(frame.patches.map((p) => [p.layerId, p.width, p.height])).toEqual([
      ['l_a', 1000, 800],
      ['l_b', 1000, 800],
    ]);
  });

  it('records only the changed area of changed layers', () => {
    const sketch = new FakeLayer(meta('l_a', 'Sketch'));
    const ink = new FakeLayer(meta('l_b', 'Ink'));
    const recorder = TimelapseRecorder.open('p_test', fakeDoc([sketch, ink]));
    const before = recorder.bytes;

    ink.paint({ x: 101, y: 203, width: 30, height: 10 });
    expect(recorder.capture()).toBe(true);

    const frames = loadTimelapse('p_test')!.frames;
    expect(frames).toHaveLength(2);
    expect(frames[1].stack).toBeUndefined();
    // Snapped outward to the 8 px grid; the untouched layer is not stored again.
    expect(frames[1].patches).toEqual([expect.objectContaining({ layerId: 'l_b', x: 96, y: 200, width: 40, height: 16 })]);
    expect(recorder.bytes - before).toBe(40 * 16);
  });

  it('writes nothing when nothing changed', () => {
    const recorder = TimelapseRecorder.open('p_test', fakeDoc([new FakeLayer(meta('l_a', 'Sketch'))]));
    const fileCount = mockFiles.size;
    expect(recorder.capture()).toBe(false);
    expect(recorder.frameCount).toBe(1);
    expect(mockFiles.size).toBe(fileCount);
  });

  it('records layer property changes without pixels', () => {
    const layer = new FakeLayer(meta('l_a', 'Sketch'));
    const recorder = TimelapseRecorder.open('p_test', fakeDoc([layer]));
    layer.meta = { ...layer.meta, visible: false };
    expect(recorder.capture()).toBe(true);
    const last = loadTimelapse('p_test')!.frames[1];
    expect(last.patches).toEqual([]);
    expect(last.stack?.[0].visible).toBe(false);
  });

  it('continues an existing recording when the artwork is reopened', () => {
    const layer = new FakeLayer(meta('l_a', 'Sketch'));
    TimelapseRecorder.open('p_test', fakeDoc([layer]));
    layer.paint({ x: 0, y: 0, width: 8, height: 8 });
    expect(TimelapseRecorder.open('p_test', fakeDoc([layer])).frameCount).toBe(2);

    // Reopened at the saved revision: nothing new to record.
    const reopened = new FakeLayer(meta('l_a', 'Sketch'));
    reopened.revision = layer.revision;
    expect(TimelapseRecorder.open('p_test', fakeDoc([reopened])).frameCount).toBe(2);

    // Reopened at an older revision (the app closed before saving): re-recorded whole.
    const recorder = TimelapseRecorder.open('p_test', fakeDoc([new FakeLayer(meta('l_a', 'Sketch'))]));
    expect(recorder.frameCount).toBe(3);
    expect(loadTimelapse('p_test')!.frames[2].patches[0]).toEqual(expect.objectContaining({ width: 1000, height: 800 }));
  });

  it('starts over when the canvas size no longer matches', () => {
    TimelapseRecorder.open('p_test', fakeDoc([new FakeLayer(meta('l_a', 'Sketch'))]));
    const recorder = TimelapseRecorder.open('p_test', fakeDoc([new FakeLayer(meta('l_a', 'Sketch'))], 500, 500));
    expect(recorder.frameCount).toBe(1);
  });

  it('spreads long recordings over several files and reads them back in order', () => {
    const layer = new FakeLayer(meta('l_a', 'Sketch'));
    const recorder = TimelapseRecorder.open('p_test', fakeDoc([layer]));
    for (let i = 0; i < 230; i++) {
      layer.paint({ x: i, y: i, width: 4, height: 4 });
      recorder.capture();
    }
    const recording = loadTimelapse('p_test')!;
    expect(recording.frames).toHaveLength(231);
    expect([...mockFiles.keys()].filter((k) => /frames-\d+\.json$/.test(k))).toHaveLength(3);
    // The patch files are numbered in recording order.
    const files = recording.frames.flatMap((f) => f.patches.map((p) => Number(p.file.replace('.png', ''))));
    expect(files).toEqual(files.map((_, i) => i));
  });

  it('deletes and restarts the recording on request', () => {
    const layer = new FakeLayer(meta('l_a', 'Sketch'));
    const recorder = TimelapseRecorder.open('p_test', fakeDoc([layer]));
    layer.paint({ x: 0, y: 0, width: 8, height: 8 });
    recorder.capture();
    recorder.reset();
    expect(recorder.frameCount).toBe(1);
    expect(loadTimelapse('p_test')!.frames).toHaveLength(1);
  });

  it('lists deleted layers so they can still be hidden', () => {
    const layers = [new FakeLayer(meta('l_a', 'Sketch')), new FakeLayer(meta('l_b', 'Ink'))];
    const recorder = TimelapseRecorder.open('p_test', fakeDoc(layers));
    layers.splice(0, 1);
    recorder.capture();
    expect(timelapseLayers(loadTimelapse('p_test')!, ['l_b'])).toEqual([
      { id: 'l_b', name: 'Ink', current: true },
      { id: 'l_a', name: 'Sketch', current: false },
    ]);
  });
});

describe('timelapse format', () => {
  it('snaps rectangles to the patch grid inside the canvas', () => {
    expect(snapToGrid({ x: 3, y: 9, width: 2, height: 2 }, 100, 100)).toEqual({ x: 0, y: 8, width: 8, height: 8 });
    expect(snapToGrid({ x: 95, y: -5, width: 20, height: 10 }, 100, 100)).toEqual({ x: 88, y: 0, width: 12, height: 8 });
    expect(snapToGrid({ x: 200, y: 0, width: 5, height: 5 }, 100, 100)).toBeNull();
  });

  it('downscales large canvases by powers of two to fit the GIF size', () => {
    expect(outputScale(800, 600)).toEqual({ divisor: 1, width: 800, height: 600 });
    expect(outputScale(2048, 1536)).toEqual({ divisor: 2, width: 1024, height: 768 });
    expect(outputScale(4000, 3000)).toEqual({ divisor: 4, width: 1000, height: 750 });
    expect(outputScale(8192, 8192)).toEqual({ divisor: 8, width: 1024, height: 1024 });
  });

  it('uses more frames for video', () => {
    expect(planPlayback(5000, 10, 30).frames.length).toBe(240);
    expect(planPlayback(5000, 10).frames.length).toBe(120);
  });

  it.each([5, 10, 15, 30, 60])('plans exactly the chosen length (%is)', (seconds) => {
    const plan = planPlayback(5000, seconds);
    expect(plan.delaysCs.reduce((a, b) => a + b, 0)).toBe(seconds * 100);
    expect(plan.frames.length).toBeLessThanOrEqual(seconds * TIMELAPSE_FPS);
    expect(plan.frames[plan.frames.length - 1]).toBe(4999);
    expect(plan.frames.every((f, i) => i === 0 || f > plan.frames[i - 1])).toBe(true);
  });

  it('plays short recordings slower instead of padding them', () => {
    const plan = planPlayback(4, 10);
    expect(plan.frames).toEqual([0, 1, 2, 3]);
    expect(plan.delaysCs.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(plan.delaysCs[3]).toBeGreaterThan(plan.delaysCs[0]);
  });

  it('rejects unusable state files', () => {
    expect(parseState(null)).toBeNull();
    expect(parseState({ format: 'zumi.timelapse', version: 99 })).toBeNull();
    expect(parseState({ format: 'zumi.timelapse', version: 1, width: -1 })).toBeNull();
  });
});
