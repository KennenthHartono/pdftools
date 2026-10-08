/**
 * Images → PDF (pdf-lib).
 *
 * JPEG and PNG files are embedded as-is (no quality loss, no re-encoding).
 * WebP, GIF, BMP and JPEGs with an EXIF rotation are decoded by the browser
 * and re-encoded first, because pdf-lib can only embed JPEG/PNG and ignores EXIF.
 */

import { loadPdfLib } from '../core/lib.js';
import { createPdfDocument, savePdf } from '../pdf/pdfDocument.js';
import { canvasToBlob } from '../pdf/pdfRender.js';
import { AppError, throwIfAborted } from '../core/errors.js';
import { releaseCanvas } from '../core/memory.js';
import { yieldToBrowser } from '../core/utils.js';

export const PAGE_SIZES_PT = Object.freeze({
  a4: [595.28, 841.89],
  letter: [612, 792],
});

const MM_TO_PT = 72 / 25.4;
/** Pixels → points for the "original size" page mode (CSS reference: 96 px per inch). */
const PX_TO_PT = 0.75;

/**
 * Where does the image go on its page? Pure function, unit-tested.
 *
 * @param {object} p
 * @param {'a4'|'letter'|'original'} p.pageSize
 * @param {'auto'|'portrait'|'landscape'} p.orientation
 * @param {number} p.marginMm
 * @param {'contain'|'cover'} p.fit
 * @param {number} p.imgW  Image width in pixels
 * @param {number} p.imgH  Image height in pixels
 * @returns {{pageW: number, pageH: number, x: number, y: number, w: number, h: number, clip: {x: number, y: number, w: number, h: number} | null}}
 *   All values in PDF points; y is measured from the bottom edge.
 */
export function computePlacement({ pageSize, orientation, marginMm, fit, imgW, imgH }) {
  const margin = Math.max(0, marginMm) * MM_TO_PT;
  let pageW;
  let pageH;

  if (pageSize === 'original') {
    pageW = imgW * PX_TO_PT + margin * 2;
    pageH = imgH * PX_TO_PT + margin * 2;
  } else {
    let [w, h] = PAGE_SIZES_PT[pageSize] ?? PAGE_SIZES_PT.a4;
    const landscape = orientation === 'landscape' || (orientation === 'auto' && imgW > imgH);
    if (landscape) [w, h] = [h, w];
    pageW = w;
    pageH = h;
  }

  const boxW = pageW - margin * 2;
  const boxH = pageH - margin * 2;
  const scale = fit === 'cover' ? Math.max(boxW / imgW, boxH / imgH) : Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const x = margin + (boxW - w) / 2;
  const y = margin + (boxH - h) / 2;
  const clip = fit === 'cover' ? { x: margin, y: margin, w: boxW, h: boxH } : null;
  return { pageW, pageH, x, y, w, h, clip };
}

/**
 * Read the EXIF orientation tag (1-8) from JPEG bytes. Returns 1 when absent.
 * @param {Uint8Array} bytes
 */
export function readJpegOrientation(bytes) {
  try {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) return 1;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) return 1; // image data starts, no EXIF seen
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      const isExif = marker === 0xe1 && bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78 && bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66;
      if (isExif) {
        const tiff = offset + 10;
        const little = bytes[tiff] === 0x49;
        const u16 = (o) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
        const u32 = (o) => (little ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0 : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0);
        const ifd = tiff + u32(tiff + 4);
        const entries = u16(ifd);
        for (let i = 0; i < entries; i++) {
          const entry = ifd + 2 + i * 12;
          if (u16(entry) === 0x0112) return u16(entry + 8) || 1;
        }
        return 1;
      }
      offset += 2 + length;
    }
  } catch {
    /* malformed EXIF: treat as upright */
  }
  return 1;
}

/** Identify an image by its first bytes (file extensions can lie). */
function sniffType(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return 'other';
}

/** Decode an image with the browser (applies EXIF rotation) onto a canvas. */
async function decodeToCanvas(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    if (!canvas.width || !canvas.height) throw new Error('empty image');
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** True if any pixel is not fully opaque. */
function hasTransparency(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * Turn any supported file into bytes pdf-lib can embed.
 * @param {File} file
 * @returns {Promise<{kind: 'jpg'|'png', bytes: Uint8Array, reencoded: boolean}>}
 */
export async function prepareImage(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);

  if (type === 'jpeg' && readJpegOrientation(bytes) === 1) return { kind: 'jpg', bytes, reencoded: false };
  if (type === 'png') return { kind: 'png', bytes, reencoded: false };

  let canvas;
  try {
    canvas = await decodeToCanvas(file);
  } catch (err) {
    throw new AppError(`"${file.name}" could not be read as an image. It may be damaged or in a format this browser cannot decode.`, { title: 'UNABLE TO READ IMAGE', code: 'CORRUPT', cause: err });
  }
  try {
    const alpha = type !== 'jpeg' && hasTransparency(canvas);
    const blob = await canvasToBlob(canvas, alpha ? 'image/png' : 'image/jpeg', 0.92);
    return { kind: alpha ? 'png' : 'jpg', bytes: new Uint8Array(await blob.arrayBuffer()), reencoded: true };
  } finally {
    releaseCanvas(canvas);
  }
}

/**
 * Build the PDF, one page per image, in the order given.
 *
 * @param {File[]} files
 * @param {object} options
 * @param {'a4'|'letter'|'original'} options.pageSize
 * @param {'auto'|'portrait'|'landscape'} options.orientation
 * @param {number} options.marginMm
 * @param {'contain'|'cover'} options.fit
 * @param {(info: import('../core/progress.js').ProgressInfo) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{bytes: Uint8Array, pageCount: number, reencoded: number}>}
 */
export async function imagesToPdf(files, { pageSize, orientation, marginMm, fit, onProgress, signal }) {
  if (!files.length) throw new AppError('Add at least one image.', { title: 'NO IMAGES', code: 'INPUT' });
  const { pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await loadPdfLib();
  const doc = await createPdfDocument();
  let reencoded = 0;

  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const file = files[i];
    onProgress?.({ percent: (i / files.length) * 95, label: 'Placing', detail: `${file.name}  (${i + 1} / ${files.length})` });
    await yieldToBrowser();

    const prepared = await prepareImage(file);
    if (prepared.reencoded) reencoded++;
    let image;
    try {
      image = prepared.kind === 'jpg' ? await doc.embedJpg(prepared.bytes) : await doc.embedPng(prepared.bytes);
    } catch (err) {
      throw new AppError(`"${file.name}" could not be embedded. It may be damaged or use an unusual encoding.`, { title: 'UNABLE TO READ IMAGE', code: 'CORRUPT', cause: err });
    }

    const place = computePlacement({ pageSize, orientation, marginMm, fit, imgW: image.width, imgH: image.height });
    const page = doc.addPage([place.pageW, place.pageH]);
    if (place.clip) {
      page.pushOperators(pushGraphicsState(), rectangle(place.clip.x, place.clip.y, place.clip.w, place.clip.h), clip(), endPath());
      page.drawImage(image, { x: place.x, y: place.y, width: place.w, height: place.h });
      page.pushOperators(popGraphicsState());
    } else {
      page.drawImage(image, { x: place.x, y: place.y, width: place.w, height: place.h });
    }
  }

  onProgress?.({ percent: 97, label: 'Saving', detail: 'Writing the PDF' });
  await yieldToBrowser();
  const bytes = await savePdf(doc);
  onProgress?.({ percent: 100, label: 'Saving', detail: 'Done' });
  return { bytes, pageCount: files.length, reencoded };
}
