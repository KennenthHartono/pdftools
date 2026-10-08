/**
 * PDF compression: two honest strategies.
 *
 *  BASIC     Re-saves the file with pdf-lib using compressed object streams.
 *            Page content and images are not re-encoded. Savings are often
 *            small and can be zero.
 *
 *  BALANCED / MAXIMUM
 *            Renders every page with PDF.js, re-encodes it as a JPEG and
 *            rebuilds the PDF. This can shrink image-heavy or scanned files a
 *            lot, but it is LOSSY and it turns text and vector graphics into
 *            pictures (text can no longer be selected or searched). For text-only
 *            PDFs the result is often larger than the original.
 */

import { loadPdfDocument, createPdfDocument, savePdf, stamp } from './pdfDocument.js';
import { openPdf, renderPageToCanvas, canvasToBlob } from './pdfRender.js';
import { releaseCanvas } from '../core/memory.js';
import { throwIfAborted } from '../core/errors.js';
import { yieldToBrowser, percentSaved } from '../core/utils.js';

/**
 * @typedef {'basic'|'balanced'|'maximum'} CompressionMode
 */

export const COMPRESSION_MODES = Object.freeze({
  basic: { label: 'BASIC', lossy: false, dpi: 0, quality: 0, summary: 'Re-saves the file with compressed structure. Content is not re-encoded, so savings are often small.' },
  balanced: { label: 'BALANCED', lossy: true, dpi: 130, quality: 0.72, summary: 'Rasterizes pages at about 130 dpi as JPEG. Good for scans and photos. Text becomes an image.' },
  maximum: { label: 'MAXIMUM', lossy: true, dpi: 85, quality: 0.5, summary: 'Rasterizes pages at about 85 dpi with strong JPEG compression. Smallest files, visibly softer pages.' },
});

/**
 * @param {File} file
 * @param {object} options
 * @param {CompressionMode} options.mode
 * @param {(info: import('../core/progress.js').ProgressInfo) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{bytes: Uint8Array, originalSize: number, resultSize: number, savedPercent: number, larger: boolean, mode: CompressionMode}>}
 */
export async function compressPdf(file, { mode, onProgress, signal }) {
  const bytes = mode === 'basic' ? await compressStructure(file, onProgress) : await compressByRasterizing(file, COMPRESSION_MODES[mode], onProgress, signal);
  const originalSize = file.size;
  const resultSize = bytes.byteLength;
  return { bytes, originalSize, resultSize, savedPercent: percentSaved(originalSize, resultSize), larger: resultSize >= originalSize, mode };
}

async function compressStructure(file, onProgress) {
  onProgress?.({ percent: 10, label: 'Reading', detail: file.name });
  await yieldToBrowser();
  const doc = await loadPdfDocument(file);
  stamp(doc);
  onProgress?.({ percent: 60, label: 'Saving', detail: 'Rewriting with compressed structure' });
  await yieldToBrowser();
  const out = await savePdf(doc);
  onProgress?.({ percent: 100, label: 'Saving', detail: 'Done' });
  return out;
}

async function compressByRasterizing(file, settings, onProgress, signal) {
  const pdf = await openPdf(file);
  try {
    const out = await createPdfDocument();
    for (let n = 1; n <= pdf.pageCount; n++) {
      throwIfAborted(signal);
      onProgress?.({ percent: ((n - 1) / pdf.pageCount) * 95, label: 'Recompressing', detail: `Page ${n} / ${pdf.pageCount}` });
      await yieldToBrowser();

      const { canvas, widthPt, heightPt } = await renderPageToCanvas(pdf.doc, n, { scale: settings.dpi / 72, signal });
      try {
        const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', settings.quality)).arrayBuffer());
        const image = await out.embedJpg(jpeg);
        const page = out.addPage([widthPt, heightPt]);
        page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
      } finally {
        releaseCanvas(canvas);
      }
    }
    onProgress?.({ percent: 97, label: 'Saving', detail: 'Writing the PDF' });
    await yieldToBrowser();
    const bytes = await savePdf(out);
    onProgress?.({ percent: 100, label: 'Saving', detail: 'Done' });
    return bytes;
  } finally {
    await pdf.destroy();
  }
}
