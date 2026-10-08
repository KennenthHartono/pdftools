# Architecture

## Principles
Static files only. Lazy loading (tool modules and libraries are `import()`ed on demand, URLs built from `import.meta.url`). Every tool follows the same flow: INPUT → OPTIONS → QUEUE → PROCESS → RESULT. Shared modules: `core/fileQueue`, `ui/uploader`, `core/progress`, `core/errors`, `core/downloads`, `core/memory`.

## Routing
Hash router: `#/<tool-id>`. Home is the empty hash. Leaving a tool disposes its *scope* (object URLs, canvases, listeners).

## Memory
`createScope()` tracks object URLs and disposers. PDF pages are rendered one at a time; thumbnails are lazy (IntersectionObserver) and off-screen canvases are released. Canvases are clamped to 16 M pixels. Files over 50 MB need confirmation.

## Libraries (vendored)
pdf-lib (edit/create PDFs), PDF.js legacy build (render), fflate (ZIP/unzip, replaces JSZip).

## Converter abstraction
```js
class DocumentConverter { async convert(file, { onProgress, signal }) -> { blob, warnings } }
class BrowserDocxConverter extends DocumentConverter {}   // current
// future: class ServerDocxConverter extends DocumentConverter {}
setConverter(new ServerDocxConverter({ endpoint })) // in js/word/converter.js
```
Tools only call `getConverter().convert(...)`, so swapping needs no UI change.

## Technical matrix

| Task | Browser support | Library | Memory risk | Limitations | Strategy |
|------|-----------------|---------|-------------|-------------|----------|
| DOCX → PDF | All modern | fflate + DOMParser + own layout + pdf-lib | Low–medium (images) | Approximate layout, standard fonts, no headers/footers/footnotes/columns/floating objects | Convert in browser, list warnings; optional server for fidelity |
| Many DOCX → one PDF | All modern | same + pdf-lib `copyPages` | Medium (all results kept until merge) | Same as above, per file | Convert sequentially, isolate failures, review, retry/skip, merge completed |
| Compress PDF | All modern | pdf-lib; PDF.js + canvas JPEG | High for Balanced/Maximum (page rasters) | Lossy modes drop text selectability; no guarantee of savings | Basic = re-save; Balanced/Maximum = one page at a time, report real result |

## CURRENT CLIENT-SIDE IMPLEMENTATION
Everything above runs in the tab. No network requests after the page loads. DOCX quality is bounded by our own layout engine and the 14 standard PDF fonts.

## FUTURE OPTIONAL SERVER CONVERTER (not implemented)
A server running LibreOffice headless (or similar) could give far better DOCX fidelity and embedded fonts, and real PDF optimisation (Ghostscript/qpdf). It would break the "nothing leaves your device" promise, so it must be opt-in, clearly labelled, and implemented as a `ServerDocxConverter` registered with `setConverter`. This repo ships no server code.

## Testing
`tests/unit.mjs` covers pure functions (range parsing, image placement, EXIF, utils). End-to-end behaviour was exercised with Playwright against Chromium.
