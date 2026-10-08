/**
 * Converter abstraction. The Word tools only ever talk to a DocumentConverter,
 * so a different engine (for example a server-side LibreOffice service) can be
 * swapped in with setConverter() and no UI code changes.
 *
 * CURRENT CLIENT-SIDE IMPLEMENTATION: BrowserDocxConverter (below).
 * FUTURE OPTIONAL SERVER CONVERTER: not included. See docs/architecture.md.
 */

import { parseDocx } from './docxParser.js';
import { renderToPdf } from './pdfRenderer.js';
import { scaleProgress } from '../core/progress.js';
import { throwIfAborted } from '../core/errors.js';

/**
 * @typedef {object} ConversionResult
 * @property {Uint8Array} bytes      The PDF.
 * @property {number} pageCount
 * @property {string[]} warnings     Features that could not be reproduced.
 */

/**
 * @typedef {object} ConvertOptions
 * @property {(info: import('../core/progress.js').ProgressInfo) => void} [onProgress]
 * @property {AbortSignal} [signal]
 */

/** Interface-like base class. */
export class DocumentConverter {
  /** Human-readable description shown in the UI. */
  get description() {
    return 'Document converter';
  }

  /**
   * @param {File} file
   * @param {ConvertOptions} [options]
   * @returns {Promise<ConversionResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async convert(file, options) {
    throw new Error('DocumentConverter.convert() must be implemented by a subclass.');
  }

  /** Alias matching the original specification. */
  convertDocxToPdf(file, options) {
    return this.convert(file, options);
  }
}

/** Parses the DOCX itself and draws it with pdf-lib. Runs entirely in the browser. */
export class BrowserDocxConverter extends DocumentConverter {
  get description() {
    return 'Browser-based converter (local, approximate layout)';
  }

  async convert(file, { onProgress, signal } = {}) {
    const ir = await parseDocx(file, { onProgress: scaleProgress(onProgress, 0, 25) });
    throwIfAborted(signal);
    return renderToPdf(ir, { onProgress, signal });
  }
}

let current = new BrowserDocxConverter();

/** The converter used by every Word tool. */
export function getConverter() {
  return current;
}

/** Replace the converter (for example with one that calls your own server). */
export function setConverter(converter) {
  if (!(converter instanceof DocumentConverter)) throw new TypeError('Converter must extend DocumentConverter.');
  current = converter;
}
