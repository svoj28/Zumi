import { HistoryManager, type HistoryCommand, type HistoryStack } from '@/engine/history/HistoryManager';

interface TestCommand extends HistoryCommand {
  log: string[];
  disposedFrom: HistoryStack | null;
}

function command(label: string, log: string[], byteSize = 1): TestCommand {
  const c: TestCommand = {
    label,
    byteSize,
    log,
    disposedFrom: null,
    undo: () => log.push(`undo ${label}`),
    redo: () => log.push(`redo ${label}`),
    dispose: (from) => {
      c.disposedFrom = from;
    },
  };
  return c;
}

describe('HistoryManager', () => {
  it('undoes and redoes in order', () => {
    const log: string[] = [];
    const h = new HistoryManager({ maxEntries: 10, maxBytes: 100 });
    h.push(command('a', log));
    h.push(command('b', log));
    expect(h.undoLabel).toBe('b');
    h.undo();
    h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.redoLabel).toBe('a');
    h.redo();
    expect(log).toEqual(['undo b', 'undo a', 'redo a']);
    expect(h.undoLabel).toBe('a');
    expect(h.redoLabel).toBe('b');
  });

  it('drops (and releases) the redo branch when a new step is pushed', () => {
    const log: string[] = [];
    const h = new HistoryManager({ maxEntries: 10, maxBytes: 100 });
    const b = command('b', log, 5);
    h.push(command('a', log, 5));
    h.push(b);
    h.undo();
    h.push(command('c', log, 5));
    expect(h.canRedo).toBe(false);
    expect(b.disposedFrom).toBe('redo');
    expect(h.byteSize).toBe(10);
  });

  it('evicts the oldest steps beyond the entry limit', () => {
    const log: string[] = [];
    const h = new HistoryManager({ maxEntries: 2, maxBytes: 100 });
    const first = command('1', log);
    h.push(first);
    h.push(command('2', log));
    h.push(command('3', log));
    expect(first.disposedFrom).toBe('undo');
    h.undo();
    h.undo();
    expect(h.canUndo).toBe(false);
  });

  it('keeps history within its memory budget', () => {
    const log: string[] = [];
    const h = new HistoryManager({ maxEntries: 100, maxBytes: 10 });
    h.push(command('a', log, 6));
    h.push(command('b', log, 6));
    expect(h.byteSize).toBe(6);
    expect(h.undoLabel).toBe('b');
  });

  it('does not keep a single step larger than the whole budget', () => {
    const log: string[] = [];
    const h = new HistoryManager({ maxEntries: 100, maxBytes: 10 });
    const huge = command('huge', log, 50);
    h.push(huge);
    expect(h.canUndo).toBe(false);
    expect(h.lastPushDiscarded).toBe(true);
    expect(huge.disposedFrom).toBe('undo');
    expect(h.byteSize).toBe(0);
  });
});
