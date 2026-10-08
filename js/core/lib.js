/**
 * Lazy loaders for the third-party libraries (all vendored in /vendor).
 *
 * Nothing heavy is fetched on the home page: each library is imported the
 * first time a tool needs it. URLs are resolved relative to this file with
 * import.meta.url, so the site works from any sub-path (GitHub Pages).
 */

const vendorBase = new URL('../../vendor/', import.meta.url);
const vendorUrl = (path) => new URL(path, vendorBase).href;

/** @type {Promise<typeof import('pdf-lib')> | null} */
let pdfLibPromise = null;
let pdfJsPromise = null;
let fflatePromise = null;

/** pdf-lib: create / modify PDFs. */
export function loadPdfLib() {
  pdfLibPromise ??= import(vendorUrl('pdf-lib/pdf-lib.esm.min.js')).catch((err) => {
    pdfLibPromise = null; // allow a retry after a network failure
    throw err;
  });
  return pdfLibPromise;
}

/** PDF.js: render PDF pages to canvas. */
export function loadPdfJs() {
  pdfJsPromise ??= import(vendorUrl('pdfjs/pdf.min.mjs'))
    .then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = vendorUrl('pdfjs/pdf.worker.min.mjs');
      return lib;
    })
    .catch((err) => {
      pdfJsPromise = null;
      throw err;
    });
  return pdfJsPromise;
}

/** Extra options so PDF.js can find fonts / colour profiles / decoders locally. */
export function pdfJsDocumentOptions() {
  return {
    cMapUrl: vendorUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: vendorUrl('pdfjs/standard_fonts/'),
    wasmUrl: vendorUrl('pdfjs/wasm/'),
    iccUrl: vendorUrl('pdfjs/iccs/'),
    isEvalSupported: false, // never eval() content coming from a document
    enableXfa: false,
  };
}

/** fflate: ZIP reading and writing. */
export function loadFflate() {
  fflatePromise ??= import(vendorUrl('fflate/fflate.esm.js')).catch((err) => {
    fflatePromise = null;
    throw err;
  });
  return fflatePromise;
}
