import { historyLimits } from '@/engine/memory';

/**
 * Command-pattern undo/redo with a memory budget.
 *
 * Commands are pushed *after* they have been applied. When the budget (entry count or bytes)
 * is exceeded the oldest undo entries are discarded, so long drawing sessions stay bounded.
 * A single step larger than the whole byte budget is not kept at all (the edit still happens,
 * it just cannot be undone) — holding it could exhaust memory.
 */

export type HistoryStack = 'undo' | 'redo';

export interface HistoryCommand {
  readonly label: string;
  /** Approximate memory held by this command (pixel snapshots etc.). */
  readonly byteSize: number;
  undo(): void;
  redo(): void;
  /**
   * Releases resources when the command is dropped. `from` tells the command which stack it
   * was dropped from, because ownership differs (e.g. a removed layer is only owned by the
   * command while the removal is in effect, i.e. while it sits on the undo stack).
   */
  dispose(from: HistoryStack): void;
}

export interface HistoryLimits {
  maxEntries: number;
  maxBytes: number;
}

export class HistoryManager {
  private undoStack: HistoryCommand[] = [];
  private redoStack: HistoryCommand[] = [];
  private bytes = 0;
  /** True when the most recent push was too large to keep (see class docs). */
  lastPushDiscarded = false;

  /** Defaults to limits derived from the device memory budget at creation time. */
  constructor(private limits: HistoryLimits = historyLimits()) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get byteSize(): number {
    return this.bytes;
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  /** Labels of the undoable steps (oldest first) and the redoable ones (next first). */
  entries(): { undo: string[]; redo: string[] } {
    return { undo: this.undoStack.map((c) => c.label), redo: [...this.redoStack].reverse().map((c) => c.label) };
  }

  push(command: HistoryCommand): void {
    for (const c of this.redoStack) {
      this.bytes -= c.byteSize;
      c.dispose('redo');
    }
    this.redoStack = [];
    this.undoStack.push(command);
    this.bytes += command.byteSize;
    this.lastPushDiscarded = false;
    this.enforceLimits();
  }

  undo(): HistoryCommand | null {
    const command = this.undoStack.pop();
    if (!command) return null;
    command.undo();
    this.redoStack.push(command);
    return command;
  }

  redo(): HistoryCommand | null {
    const command = this.redoStack.pop();
    if (!command) return null;
    command.redo();
    this.undoStack.push(command);
    return command;
  }

  clear(): void {
    for (const c of this.undoStack) c.dispose('undo');
    for (const c of this.redoStack) c.dispose('redo');
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }

  private enforceLimits(): void {
    while (
      this.undoStack.length > 0 &&
      (this.undoStack.length > this.limits.maxEntries || this.bytes > this.limits.maxBytes)
    ) {
      const oldest = this.undoStack.shift()!;
      this.bytes -= oldest.byteSize;
      oldest.dispose('undo');
      if (this.undoStack.length === 0) this.lastPushDiscarded = true;
    }
  }
}
