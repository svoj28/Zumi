import { classifyError, describeError, errorText } from '@/utils/errors';

describe('describeError', () => {
  it('explains a native "disk full" failure in plain words', () => {
    const native = new Error("Calling the 'write' function has failed", { cause: new Error('ENOSPC: no space left on device') });
    const d = describeError(native);
    expect(d.kind).toBe('storage-full');
    expect(d.title).toBe('Storage is full');
    expect(d.message).not.toMatch(/function has failed/);
    expect(d.recovery).toMatch(/Free up space/);
  });

  it('keeps Zumi’s own specific messages', () => {
    const d = describeError(new Error('This artwork could not be found or is damaged.'));
    expect(d.kind).toBe('damaged');
    expect(d.message).toBe('This artwork could not be found or is damaged.');
  });

  it.each([
    ['Permission denied by user', 'permission'],
    ['Unable to allocate a 8192×8192 layer (out of memory?)', 'out-of-memory'],
    ['This image format is not supported.', 'unsupported-image'],
    ['This backup is incomplete.', 'damaged'],
    ['Sharing is not available on this device.', 'unknown'],
  ])('classifies "%s" as %s', (message, kind) => {
    expect(classifyError(new Error(message))).toBe(kind);
  });

  it('always offers a next step, even for unknown errors', () => {
    const d = describeError('weird', 'Export failed');
    expect(d.title).toBe('Export failed');
    expect(d.message).toBe('weird');
    expect(errorText(d)).toContain(d.recovery);
    expect(d.recovery.length).toBeGreaterThan(0);
  });
});
