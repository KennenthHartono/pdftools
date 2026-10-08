/**
 * FileQueue: the single data model behind every multi-file tool
 * (merger, images → PDF, Word → PDF, Word → one PDF) and, with one item,
 * the single-file tools too.
 *
 * Item shape:
 *   { id, file, name, size, type, status, progress, error, meta }
 * status: 'idle' | 'processing' | 'completed' | 'error'
 */

import { extOf } from './utils.js';

/** @typedef {'idle'|'processing'|'completed'|'error'} QueueStatus */
/**
 * @typedef {object} QueueItem
 * @property {string} id
 * @property {File} file
 * @property {string} name
 * @property {number} size
 * @property {string} type
 * @property {QueueStatus} status
 * @property {number} progress  0-100
 * @property {string|null} error  Human-readable reason when status === 'error'
 * @property {Record<string, any>} meta  Tool-specific data (page count, warnings, ...)
 */

let sequence = 0;

/** @returns {QueueItem} */
export function createQueueItem(file, meta = {}) {
  return {
    id: `item-${++sequence}`,
    file,
    name: file.name,
    size: file.size,
    type: file.type || extOf(file.name),
    status: 'idle',
    progress: 0,
    error: null,
    meta: { ...meta },
  };
}

export class FileQueue {
  /** @type {QueueItem[]} */
  #items = [];
  #listeners = new Set();

  get items() {
    return this.#items;
  }

  get length() {
    return this.#items.length;
  }

  /** @param {string} id */
  get(id) {
    return this.#items.find((item) => item.id === id);
  }

  /**
   * Listen for any change. Returns an unsubscribe function.
   * @param {(items: QueueItem[], reason: string) => void} fn
   */
  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(reason) {
    for (const fn of this.#listeners) fn(this.#items, reason);
  }

  /**
   * @param {File[]} files
   * @returns {QueueItem[]} the items that were created
   */
  add(files) {
    const created = files.map((file) => createQueueItem(file));
    this.#items.push(...created);
    this.#emit('add');
    return created;
  }

  remove(id) {
    const before = this.#items.length;
    this.#items = this.#items.filter((item) => item.id !== id);
    if (this.#items.length !== before) this.#emit('remove');
  }

  /** Move an item up (-1) or down (+1). */
  move(id, delta) {
    const from = this.#items.findIndex((item) => item.id === id);
    if (from < 0) return;
    this.moveTo(id, from + delta);
  }

  /** Move an item so it ends up at `index`. */
  moveTo(id, index) {
    const from = this.#items.findIndex((item) => item.id === id);
    const to = Math.max(0, Math.min(this.#items.length - 1, index));
    if (from < 0 || from === to) return;
    const [item] = this.#items.splice(from, 1);
    this.#items.splice(to, 0, item);
    this.#emit('move');
  }

  clear() {
    if (!this.#items.length) return;
    this.#items = [];
    this.#emit('clear');
  }

  /**
   * Update fields of an item. `meta` is merged, everything else is assigned.
   * @param {string} id
   * @param {Partial<QueueItem>} patch
   */
  update(id, patch) {
    const item = this.get(id);
    if (!item) return;
    const { meta, ...rest } = patch;
    Object.assign(item, rest);
    if (meta) Object.assign(item.meta, meta);
    this.#emit('update');
  }

  /** Reset every item to idle (used before re-running a batch). */
  resetStatuses() {
    for (const item of this.#items) {
      item.status = 'idle';
      item.progress = 0;
      item.error = null;
    }
    this.#emit('update');
  }
}
