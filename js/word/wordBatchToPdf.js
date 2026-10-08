/**
 * Many Word files → ONE PDF.
 *
 *   validate → convert #1 → convert #2 … → merge → final PDF
 *
 * Files are converted one after another (never in parallel) to keep memory
 * flat. A failing document is recorded and the loop continues, so one bad
 * file never aborts the batch. The caller can retry or skip failed files and
 * then call mergeConverted().
 */

import { convertWordToPdf } from './wordToPdf.js';
import { loadPdfLib } from '../core/lib.js';
import { createPdfDocument, savePdf } from '../pdf/pdfDocument.js';
import { AppError, throwIfAborted } from '../core/errors.js';
import { yieldToBrowser } from '../core/utils.js';

/**
 * Convert one queue item and store the outcome in `results`.
 *
 * @param {import('../core/fileQueue.js').QueueItem} item
 * @param {Map<string, {bytes: Uint8Array, pageCount: number, warnings: string[]}>} results
 * @param {object} hooks
 * @param {(p: number) => void} [hooks.onItemProgress]  0-100 for this file
 * @param {AbortSignal} [hooks.signal]
 * @returns {Promise<{ok: true} | {ok: false, error: Error}>}
 */
export async function convertOne(item, results, { onItemProgress, signal } = {}) {
  try {
    const result = await convertWordToPdf(item.file, { signal, onProgress: (info) => onItemProgress?.(info.percent) });
    results.set(item.id, result);
    return { ok: true };
  } catch (error) {
    results.delete(item.id);
    if (error?.code === 'ABORTED') throw error;
    return { ok: false, error };
  }
}

/**
 * Convert every item that has no result yet.
 *
 * @param {import('../core/fileQueue.js').QueueItem[]} items
 * @param {Map<string, any>} results
 * @param {object} hooks
 * @param {(item: any) => void} [hooks.onStart]
 * @param {(item: any, outcome: {ok: boolean, error?: Error}) => void} [hooks.onDone]
 * @param {(item: any, percent: number) => void} [hooks.onItemProgress]
 * @param {AbortSignal} [hooks.signal]
 */
export async function convertAll(items, results, { onStart, onDone, onItemProgress, signal } = {}) {
  for (const item of items) {
    throwIfAborted(signal);
    if (results.has(item.id)) continue;
    onStart?.(item);
    await yieldToBrowser();
    const outcome = await convertOne(item, results, { signal, onItemProgress: (p) => onItemProgress?.(item, p) });
    onDone?.(item, outcome);
  }
}

/**
 * Merge the converted documents, in queue order.
 * @param {import('../core/fileQueue.js').QueueItem[]} items  Items to include (skipped ones omitted by the caller).
 * @param {Map<string, {bytes: Uint8Array, pageCount: number}>} results
 * @returns {Promise<{bytes: Uint8Array, pageCount: number, documents: number}>}
 */
export async function mergeConverted(items, results, { onProgress } = {}) {
  const ready = items.filter((i) => results.has(i.id));
  if (!ready.length) throw new AppError('None of the documents could be converted, so there is nothing to merge.', { title: 'NOTHING TO MERGE', code: 'INPUT' });

  const { PDFDocument } = await loadPdfLib();
  const out = await createPdfDocument();
  for (let i = 0; i < ready.length; i++) {
    onProgress?.({ percent: (i / ready.length) * 95, label: 'Merging', detail: ready[i].name });
    await yieldToBrowser();
    const src = await PDFDocument.load(results.get(ready[i].id).bytes, { updateMetadata: false });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  onProgress?.({ percent: 98, label: 'Saving', detail: 'Writing the final PDF' });
  await yieldToBrowser();
  const bytes = await savePdf(out);
  onProgress?.({ percent: 100, label: 'Saving', detail: 'Done' });
  return { bytes, pageCount: out.getPageCount(), documents: ready.length };
}
