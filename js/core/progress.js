/**
 * Progress plumbing.
 *
 * Long-running functions accept an `onProgress` callback and call it with
 * `{ percent, label?, detail? }`. The UI (ui/components.js → progressPanel)
 * turns that into the progress bar; the processing modules stay DOM-free.
 */

import { yieldToBrowser } from './utils.js';

/**
 * @typedef {object} ProgressInfo
 * @property {number} percent  0-100
 * @property {string} [label]  Main line, e.g. "Converting"
 * @property {string} [detail] Second line, e.g. a file name or "Page 8 / 10"
 */

/** @param {number} p */
export function clampPercent(p) {
  return Math.max(0, Math.min(100, Number.isFinite(p) ? p : 0));
}

/**
 * Map a child operation's 0-100 progress into the [from, to] slice of a parent.
 * @param {(info: ProgressInfo) => void} [onProgress]
 */
export function scaleProgress(onProgress, from, to) {
  if (!onProgress) return undefined;
  return (info) =>
    onProgress({ ...info, percent: from + ((to - from) * clampPercent(info.percent ?? 0)) / 100 });
}

/**
 * Counts completed steps and reports percent. Yields to the event loop after
 * each tick so the browser can repaint between heavy steps.
 */
export function createStepper(total, onProgress, label) {
  let done = 0;
  const percent = () => (total ? (done / total) * 100 : 100);
  return {
    /** Announce that a step is starting (does not advance). */
    begin(detail) {
      onProgress?.({ percent: percent(), label, detail });
    },
    /** Mark a step finished. */
    async tick(detail) {
      done++;
      onProgress?.({ percent: percent(), label, detail });
      await yieldToBrowser();
    },
  };
}
