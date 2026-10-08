/**
 * Thin wrapper around PDF.js: open a document, render a page to a canvas.
 * PDF.js is imported lazily the first time one of these functions runs.
 */

import { loadPdfJs, pdfJsDocumentOptions } from '../core/lib.js';
import { CONFIG } from '../config.js';

/**
 * Open a PDF for rendering.
 * @param {File | Blob} file
 * @returns {Promise<{doc: any, pageCount: number, destroy: () => Promise<void>}>}
 */
export async function openPdf(file) {
  const pdfjs = await loadPdfJs();
  // PDF.js transfers (detaches) this buffer to its worker, so it is not reused.
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, ...pdfJsDocumentOptions() });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    task.destroy?.();
    throw err;
  }
  return {
    doc,
    pageCount: doc.numPages,
    async destroy() {
      try {
        await doc.destroy();
      } catch {
        /* already destroyed */
      }
    },
  };
}

/**
 * Render one page.
 *
 * @param {any} doc  PDF.js document
 * @param {number} pageNumber  1-based
 * @param {object} [options]
 * @param {number} [options.scale=1]           1 = 72 dpi (one CSS px per PDF point)
 * @param {number} [options.maxDimension]      Fit the longest edge to this many pixels (overrides scale)
 * @param {HTMLCanvasElement} [options.canvas] Reuse an existing canvas
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{canvas: HTMLCanvasElement, widthPt: number, heightPt: number, clamped: boolean}>}
 */
export async function renderPageToCanvas(doc, pageNumber, { scale = 1, maxDimension, canvas, signal } = {}) {
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    let s = maxDimension ? maxDimension / Math.max(base.width, base.height) : scale;

    // Stay under the browser's canvas size limit (important on iOS Safari).
    let clamped = false;
    const pixels = base.width * s * (base.height * s);
    if (pixels > CONFIG.maxCanvasPixels) {
      s *= Math.sqrt(CONFIG.maxCanvasPixels / pixels);
      clamped = true;
    }

    const viewport = page.getViewport({ scale: s });
    const target = canvas ?? document.createElement('canvas');
    target.width = Math.max(1, Math.floor(viewport.width));
    target.height = Math.max(1, Math.floor(viewport.height));
    const ctx = target.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff'; // PDF pages are white unless they paint otherwise
    ctx.fillRect(0, 0, target.width, target.height);

    const task = page.render({ canvasContext: ctx, canvas: target, viewport });
    const onAbort = () => task.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await task.promise;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    return { canvas: target, widthPt: base.width, heightPt: base.height, clamped };
  } finally {
    page.cleanup();
  }
}

/**
 * Promise wrapper for canvas.toBlob.
 * @param {HTMLCanvasElement} canvas
 * @param {string} [type]
 * @param {number} [quality] 0-1, JPEG only
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed (the image may be too large for this browser).'))), type, quality);
  });
}
