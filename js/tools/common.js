/**
 * Helpers shared by the tool pages.
 */

import { h } from '../ui/components.js';

/** @type {import('../ui/uploader.js').FileKind} */
export const PDF_KIND = { extensions: ['pdf'], mimeTypes: ['application/pdf'], label: 'PDF' };
/** @type {import('../ui/uploader.js').FileKind} */
export const IMAGE_KIND = { extensions: ['jpg', 'jpeg', 'png', 'webp'], mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], label: 'image' };
/** @type {import('../ui/uploader.js').FileKind} */
export const DOCX_KIND = { extensions: ['docx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], label: 'Word (.docx)' };

/** Row of buttons (and an optional note) at the bottom of a panel. */
export function actionBar(...children) {
  return h('div', { class: 'action-bar' }, ...children);
}

/** Wrap bytes in a Blob. */
export const toBlob = (bytes, type) => new Blob([bytes], { type });

/**
 * Create an AbortController that is cancelled automatically when the tool is closed.
 * @param {import('../core/memory.js').Scope} scope
 */
export function createAbort(scope) {
  const controller = new AbortController();
  scope.onDispose(() => controller.abort());
  return controller;
}

/** Disable/enable a set of controls while a job runs. */
export function setBusy(busy, ...controls) {
  for (const c of controls) {
    if (!c) continue;
    if (typeof c.setDisabled === 'function') c.setDisabled(busy);
    else if ('disabled' in c) c.disabled = busy;
  }
}
