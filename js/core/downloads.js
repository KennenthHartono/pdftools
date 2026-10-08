/**
 * Download utilities: one function for single files, one for ZIP bundles.
 */

import { loadFflate } from './lib.js';
import { uniqueName, yieldToBrowser } from './utils.js';

/**
 * Trigger a browser download for a Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * @typedef {object} ZipEntry
 * @property {string} name
 * @property {Blob} [blob]
 * @property {Uint8Array} [bytes]
 */

/**
 * Build a ZIP in memory. Entries are stored without recompression because the
 * typical content (PDF, JPG, PNG) is already compressed.
 * @param {ZipEntry[]} entries
 * @param {(info: {percent: number, label: string, detail?: string}) => void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function createZip(entries, onProgress) {
  const { zipSync } = await loadFflate();
  const used = new Set();
  const files = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const name = uniqueName(entry.name, used);
    const bytes = entry.bytes ?? new Uint8Array(await entry.blob.arrayBuffer());
    files[name] = [bytes, { level: 0 }];
    onProgress?.({ percent: ((i + 1) / entries.length) * 90, label: 'PACKING ZIP', detail: name });
    await yieldToBrowser();
  }
  const zipped = zipSync(files);
  onProgress?.({ percent: 100, label: 'PACKING ZIP' });
  return new Blob([zipped], { type: 'application/zip' });
}

/**
 * Create a ZIP and download it.
 * @param {ZipEntry[]} entries
 * @param {string} zipName
 */
export async function downloadZip(entries, zipName, onProgress) {
  const blob = await createZip(entries, onProgress);
  downloadBlob(blob, zipName);
  return blob;
}
