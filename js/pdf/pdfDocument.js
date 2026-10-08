/**
 * Shared pdf-lib helpers (load / create / save) so every PDF module behaves the same.
 */

import { loadPdfLib } from '../core/lib.js';

/**
 * Load a PDF with pdf-lib.
 * Encrypted files are rejected on purpose: loading them "anyway" would
 * produce unreadable pages, so the user gets a clear message instead.
 * @param {File | Blob} file
 */
export async function loadPdfDocument(file) {
  const { PDFDocument } = await loadPdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/** Create an empty document stamped with this app as producer. */
export async function createPdfDocument() {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  stamp(doc);
  return doc;
}

/** @param {import('pdf-lib').PDFDocument} doc */
export function stamp(doc) {
  doc.setProducer('Document Lab');
  doc.setCreator('Document Lab');
}

/**
 * Serialize a document.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {Promise<Uint8Array>}
 */
export function savePdf(doc) {
  return doc.save({ useObjectStreams: true });
}

/** Wrap bytes in a PDF Blob. */
export function pdfBlob(bytes) {
  return new Blob([bytes], { type: 'application/pdf' });
}
