/**
 * PDF splitter (pdf-lib): every page, page ranges, or a hand-picked selection.
 */

import { loadPdfDocument, createPdfDocument, savePdf } from './pdfDocument.js';
import { throwIfAborted, AppError } from '../core/errors.js';
import { pad, yieldToBrowser } from '../core/utils.js';

/**
 * Parse text such as "1-3, 5, 8-10" or "7-" (7 to the end) into ranges.
 * Pure function: no DOM, easy to unit-test.
 *
 * @param {string} text
 * @param {number} pageCount
 * @returns {{ranges: {start: number, end: number}[], error?: string}}
 */
export function parseRanges(text, pageCount) {
  const input = text.trim();
  if (!input) return { ranges: [], error: 'Enter at least one page or range, for example 1-3, 5, 8-10.' };

  const ranges = [];
  for (const raw of input.split(/[,;\n]+/)) {
    const part = raw.trim().replace(/\s+/g, '');
    if (!part) continue;
    let start;
    let end;
    let m;
    if ((m = /^(\d+)$/.exec(part))) {
      start = end = Number(m[1]);
    } else if ((m = /^(\d+)-(\d+)$/.exec(part))) {
      start = Number(m[1]);
      end = Number(m[2]);
    } else if ((m = /^(\d+)-$/.exec(part))) {
      start = Number(m[1]);
      end = pageCount;
    } else {
      return { ranges: [], error: `"${raw.trim()}" is not a valid page or range. Use numbers like 5 or 3-7.` };
    }
    if (start < 1 || end < 1) return { ranges: [], error: 'Page numbers start at 1.' };
    if (start > pageCount || end > pageCount) {
      return { ranges: [], error: `Page ${Math.max(start, end)} does not exist: this PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}.` };
    }
    if (start > end) return { ranges: [], error: `Range ${start}-${end} runs backwards. Write it as ${end}-${start}.` };
    ranges.push({ start, end });
  }
  if (!ranges.length) return { ranges: [], error: 'Enter at least one page or range, for example 1-3, 5, 8-10.' };
  return { ranges };
}

/** "pages 3-5" / "page 7" */
export function describeRange({ start, end }) {
  return start === end ? `page ${start}` : `pages ${start}–${end}`;
}

/**
 * @typedef {object} SplitOutput
 * @property {string} name
 * @property {Uint8Array} bytes
 * @property {string} label  Which pages ended up in this file.
 */

/**
 * @param {File} file
 * @param {object} options
 * @param {'each'|'ranges'|'selected'} options.mode
 * @param {{start: number, end: number}[]} [options.ranges]   For mode "ranges".
 * @param {boolean} [options.combine]                          Put all ranges into ONE file.
 * @param {number[]} [options.pages]                           For mode "selected" (1-based).
 * @param {string} options.baseName
 * @param {(info: import('../core/progress.js').ProgressInfo) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<SplitOutput[]>}
 */
export async function splitPdf(file, { mode, ranges = [], combine = false, pages = [], baseName, onProgress, signal }) {
  const src = await loadPdfDocument(file);
  const total = src.getPageCount();

  /** @type {{label: string, indices: number[]}[]} */
  let jobs;
  if (mode === 'each') {
    jobs = Array.from({ length: total }, (_, i) => ({ label: `page ${i + 1}`, indices: [i] }));
  } else if (mode === 'ranges') {
    const toIndices = (r) => Array.from({ length: r.end - r.start + 1 }, (_, k) => r.start - 1 + k);
    jobs = combine
      ? [{ label: ranges.map(describeRange).join(', '), indices: ranges.flatMap(toIndices) }]
      : ranges.map((r) => ({ label: describeRange(r), indices: toIndices(r) }));
  } else {
    jobs = [{ label: `${pages.length} selected page${pages.length === 1 ? '' : 's'}`, indices: pages.map((p) => p - 1) }];
  }

  if (!jobs.length || jobs.some((j) => !j.indices.length)) {
    throw new AppError('No pages were chosen to extract.', { title: 'NOTHING TO EXTRACT', code: 'INPUT' });
  }

  const digits = Math.max(2, String(jobs.length).length);
  const outputs = [];
  for (let i = 0; i < jobs.length; i++) {
    throwIfAborted(signal);
    onProgress?.({ percent: (i / jobs.length) * 100, label: 'Splitting', detail: `File ${i + 1} / ${jobs.length}  (${jobs[i].label})` });
    await yieldToBrowser();
    const out = await createPdfDocument();
    const copied = await out.copyPages(src, jobs[i].indices);
    for (const page of copied) out.addPage(page);
    const name = jobs.length === 1 && mode === 'selected' ? `${baseName}_selected.pdf` : `${baseName}_${pad(i + 1, digits)}.pdf`;
    outputs.push({ name, bytes: await savePdf(out), label: jobs[i].label });
  }
  onProgress?.({ percent: 100, label: 'Splitting', detail: 'Done' });
  return outputs;
}
