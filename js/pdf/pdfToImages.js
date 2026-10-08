/**
 * PDF → JPG / PNG using PDF.js for rendering.
 */

import { renderPageToCanvas, canvasToBlob } from './pdfRender.js';
import { releaseCanvas } from '../core/memory.js';
import { throwIfAborted } from '../core/errors.js';
import { pad, yieldToBrowser } from '../core/utils.js';

/**
 * @typedef {object} PageImage
 * @property {number} page
 * @property {string} name
 * @property {Blob} blob
 * @property {number} width
 * @property {number} height
 */

/**
 * Render the chosen pages one at a time (never all at full size at once).
 *
 * @param {object} options
 * @param {any} options.doc                 PDF.js document
 * @param {number[]} options.pages          1-based page numbers
 * @param {'jpg'|'png'} options.format
 * @param {number} [options.quality=0.9]    JPEG quality 0-1
 * @param {number} [options.dpi=150]        Render resolution (72 = screen size)
 * @param {string} options.baseName         Used for output file names
 * @param {(info: import('../core/progress.js').ProgressInfo) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{images: PageImage[], clamped: number}>}
 *   `clamped` counts pages whose resolution had to be reduced to fit the browser's canvas limit.
 */
export async function convertPagesToImages({ doc, pages, format, quality = 0.9, dpi = 150, baseName, onProgress, signal }) {
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const width = Math.max(2, String(doc.numPages).length);
  const images = [];
  let clamped = 0;

  for (let i = 0; i < pages.length; i++) {
    throwIfAborted(signal);
    const pageNumber = pages[i];
    onProgress?.({ percent: (i / pages.length) * 100, label: 'Rendering', detail: `Page ${pageNumber} / ${doc.numPages}` });
    await yieldToBrowser();

    const rendered = await renderPageToCanvas(doc, pageNumber, { scale: dpi / 72, signal });
    if (rendered.clamped) clamped++;
    const { canvas } = rendered;
    const w = canvas.width;
    const h = canvas.height;
    try {
      const blob = await canvasToBlob(canvas, mime, format === 'jpg' ? quality : undefined);
      images.push({ page: pageNumber, name: `${baseName}_page-${pad(pageNumber, width)}.${format}`, blob, width: w, height: h });
    } finally {
      releaseCanvas(canvas);
    }
  }

  onProgress?.({ percent: 100, label: 'Rendering', detail: 'Done' });
  return { images, clamped };
}
