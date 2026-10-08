/**
 * PDF merger (pdf-lib).
 */

import { loadPdfDocument, createPdfDocument, savePdf } from './pdfDocument.js';
import { AppError, humanizeError, throwIfAborted } from '../core/errors.js';
import { yieldToBrowser } from '../core/utils.js';

/**
 * Read the page count of a PDF without keeping it in memory.
 * @param {File} file
 * @returns {Promise<number>}
 */
export async function getPdfPageCount(file) {
  const doc = await loadPdfDocument(file);
  return doc.getPageCount();
}

/**
 * Merge PDFs in the given order. Files are loaded one after another so only
 * one source document is held in memory at a time.
 *
 * @param {File[]} files
 * @param {object} [options]
 * @param {(info: import('../core/progress.js').ProgressInfo) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{bytes: Uint8Array, pageCount: number}>}
 * @throws {AppError} with `failedIndex` set when one input cannot be read.
 */
export async function mergePdfs(files, { onProgress, signal } = {}) {
  if (files.length < 2) throw new AppError('Add at least two PDF files to merge.', { title: 'NOTHING TO MERGE', code: 'INPUT' });
  const out = await createPdfDocument();

  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const file = files[i];
    onProgress?.({ percent: (i / files.length) * 95, label: 'Merging', detail: `${file.name}  (${i + 1} / ${files.length})` });
    await yieldToBrowser();
    try {
      const src = await loadPdfDocument(file);
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const page of pages) out.addPage(page);
    } catch (err) {
      const { message } = humanizeError(err, 'pdf');
      const wrapped = new AppError(`"${file.name}": ${message}`, { title: 'A FILE COULD NOT BE MERGED', code: 'CORRUPT', cause: err });
      wrapped.failedIndex = i;
      throw wrapped;
    }
  }

  onProgress?.({ percent: 97, label: 'Saving', detail: 'Writing the merged PDF' });
  await yieldToBrowser();
  const bytes = await savePdf(out);
  onProgress?.({ percent: 100, label: 'Saving', detail: 'Done' });
  return { bytes, pageCount: out.getPageCount() };
}
