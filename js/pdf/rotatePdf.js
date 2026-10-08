/**
 * Rotate pages (pdf-lib). Rotation is added to whatever rotation the page already has.
 */

import { loadPdfLib } from '../core/lib.js';
import { loadPdfDocument, savePdf, stamp } from './pdfDocument.js';
import { AppError } from '../core/errors.js';
import { yieldToBrowser } from '../core/utils.js';

/**
 * @param {File} file
 * @param {object} options
 * @param {90|180|270} options.angle           Degrees clockwise.
 * @param {number[] | null} options.pages      1-based pages to rotate, or null for all pages.
 * @param {(info: import('../core/progress.js').ProgressInfo) => void} [options.onProgress]
 * @returns {Promise<{bytes: Uint8Array, rotated: number}>}
 */
export async function rotatePdf(file, { angle, pages, onProgress }) {
  if (![90, 180, 270].includes(angle)) throw new AppError('Choose 90°, 180° or 270°.', { code: 'INPUT' });
  const { degrees } = await loadPdfLib();
  const doc = await loadPdfDocument(file);
  const all = doc.getPages();
  const targets = pages ?? all.map((_, i) => i + 1);
  if (!targets.length) throw new AppError('Select at least one page to rotate.', { title: 'NO PAGES SELECTED', code: 'INPUT' });

  for (let i = 0; i < targets.length; i++) {
    const page = all[targets[i] - 1];
    const current = page.getRotation().angle;
    page.setRotation(degrees((((current + angle) % 360) + 360) % 360));
    if (i % 50 === 49) {
      onProgress?.({ percent: (i / targets.length) * 90, label: 'Rotating', detail: `Page ${targets[i]} / ${all.length}` });
      await yieldToBrowser();
    }
  }

  stamp(doc);
  onProgress?.({ percent: 95, label: 'Saving', detail: 'Writing the PDF' });
  await yieldToBrowser();
  const bytes = await savePdf(doc);
  onProgress?.({ percent: 100, label: 'Saving', detail: 'Done' });
  return { bytes, rotated: targets.length };
}
