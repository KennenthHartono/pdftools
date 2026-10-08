/**
 * Memory hygiene.
 *
 * Every tool runs inside a "scope". Anything that must be released when the
 * user leaves the tool (object URLs, open PDF.js documents, listeners) is
 * registered on the scope and cleaned up in one call to dispose().
 */

import { CONFIG } from '../config.js';

/**
 * @typedef {object} Scope
 * @property {(blob: Blob) => string} url      Create and track an object URL.
 * @property {(url: string) => void} revoke    Revoke one tracked URL early.
 * @property {(fn: () => void | Promise<void>) => void} onDispose
 * @property {() => Promise<void>} dispose
 * @property {boolean} disposed
 */

/** @returns {Scope} */
export function createScope() {
  const urls = new Set();
  const disposers = [];
  const scope = {
    disposed: false,
    url(blob) {
      const u = URL.createObjectURL(blob);
      urls.add(u);
      return u;
    },
    revoke(u) {
      if (urls.delete(u)) URL.revokeObjectURL(u);
    },
    onDispose(fn) {
      disposers.push(fn);
    },
    async dispose() {
      if (scope.disposed) return;
      scope.disposed = true;
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
      for (const fn of disposers.splice(0).reverse()) {
        try {
          await fn();
        } catch (err) {
          console.warn('[Document Lab] cleanup failed', err);
        }
      }
    },
  };
  return scope;
}

/** True when a file is above the configured "large file" threshold. */
export function isLargeFile(file) {
  return file.size > CONFIG.largeFileBytes;
}

/**
 * Release a canvas backing store immediately instead of waiting for GC.
 * @param {HTMLCanvasElement} canvas
 */
export function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
