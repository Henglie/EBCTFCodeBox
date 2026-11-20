/**
 * canvasHistory.js — 撤销/重做栈（快照式）与内部剪贴板。
 *
 * 快照式：每次提交存「变更前」的图与选中集；栈上限默认 200（MT809 要求 ≥100）。
 * 画布只在离散操作（拖动结束、连线、删除、粘贴、折叠…）时提交，拖动过程中不提交。
 */

import { clone } from './canvasModel.js';

export function createHistory({ limit = 200 } = {}) {
  const undoStack = [];
  const redoStack = [];

  /** 记录「变更前」快照；新的编辑必然清空重做栈。 */
  function record(snapshot) {
    undoStack.push(snapshot);
    if (undoStack.length > limit) undoStack.shift();
    redoStack.length = 0;
    return undoStack.length;
  }

  /** 返回要恢复的快照，并把当前状态压入重做栈。 */
  function undo(current) {
    if (!undoStack.length) return null;
    const entry = undoStack.pop();
    redoStack.push(current);
    return entry;
  }

  function redo(current) {
    if (!redoStack.length) return null;
    const entry = redoStack.pop();
    undoStack.push(current);
    return entry;
  }

  function clear() {
    undoStack.length = 0;
    redoStack.length = 0;
  }

  return {
    record,
    undo,
    redo,
    clear,
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get undoSize() { return undoStack.length; },
    get redoSize() { return redoStack.length; },
    get limit() { return limit; },
  };
}

/** 画布内部剪贴板：存一份与图无关的子图，粘贴时重编号并整体偏移。 */
export function createClipboard() {
  let payload = null;
  return {
    write(data) { payload = data ? clone(data) : null; },
    read() { return payload ? clone(payload) : null; },
    get empty() { return !payload || (!payload.nodes.length && !payload.groups.length); },
    clear() { payload = null; },
  };
}
