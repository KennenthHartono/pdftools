# DOCUMENT // LAB

Local-first PDF, image and Word tools that run **entirely in your browser**. Static site: no server, no upload, no account, no analytics.

Plain HTML5 + CSS3 + JavaScript ES modules. No framework, no CDN at runtime.

## Tools

| # | Tool | What it does |
|---|------|--------------|
| 01 | PDF → Images | Render pages as JPG or PNG (page selection, DPI/quality, ZIP) |
| 02 | PDF Merger | Join PDFs, drag or ↑↓ to reorder |
| 03 | PDF Splitter | One file per page, per range (`1-3, 5, 8-10`), or extract selected pages |
| 04 | Rotate PDF | 90/180/270° on all or chosen pages, thumbnail preview |
| 05 | Images → PDF | JPG/PNG/WEBP/GIF/BMP to PDF; A4/Letter/original, margin, orientation, fit; EXIF aware |
| 06 | Compress PDF | Basic (lossless re-save), Balanced and Maximum (lossy rasterize), honest result report |
| 07 | Word → PDF | `.docx` to PDF with a built-in converter |
| 08 | Word → One PDF | Many `.docx` converted and merged into one PDF; failures never stop the rest |

## Run locally

```bash
npm install          # only needed to refresh /vendor; vendored files are already committed
python3 -m http.server 8080   # or: npx serve .
# open http://localhost:8080
```

ES modules need HTTP; opening `index.html` via `file://` will not work.

```bash
npm run test:unit    # pure-function tests (Node 18+)
npm run vendor       # re-copy libs/fonts from node_modules into /vendor and /assets/fonts
```

## Deploy

All paths are relative, so any sub-path works.

- **GitHub Pages**: push, then Settings → Pages → Deploy from branch → `main` / root. `.nojekyll` is included.
- **Netlify / Cloudflare Pages / Vercel**: no build command, publish directory `.`.

### Set your GitHub link
Replace `https://github.com/YOUR_USERNAME/YOUR_REPOSITORY` in `js/config.js` (`githubUrl`). The same placeholder is the fallback `href` of the three `data-github-link` anchors in `index.html`.

## Browsers
Current Chrome, Edge, Firefox and Safari (ES modules, `import()`, canvas, Blob). PDF.js is the *legacy* build for wider support. A banner appears if a required feature is missing.

## Privacy
Files are read with the File API and processed in memory. Nothing is sent anywhere. The only thing stored is the light/dark choice (`localStorage`). Object URLs and canvases are released when you leave a tool.

## Known limitations (read this)

- **Word → PDF is an approximation.** The converter is our own (fflate + XML parsing + a layout engine drawing with pdf-lib). It handles paragraphs, character formatting, headings, lists, tabs, tables, inline images, page breaks and sections. It does **not** reproduce Word exactly. Not supported (reported as warnings): headers/footers, footnotes, text boxes, charts, equations, multi-column layout, floating images, paragraph borders/shading. Only the 14 standard PDF fonts are used, so characters outside Latin-1/WinAnsi (CJK, Arabic, emoji, …) become `?`. Original fonts are not embedded. Legacy `.doc` is not supported.
- For pixel-faithful conversion, use Word/LibreOffice or a server converter (see `docs/architecture.md`).
- **Compression is not guaranteed.** Basic often saves little. Balanced/Maximum turn pages into JPEG images: text is no longer selectable and quality drops. If the output is larger, the app says so.
- Encrypted PDFs are not supported.
- Very large files are limited by your device's memory; files over 50 MB trigger a confirmation.

## Project layout
```
index.html  css/  js/{core,ui,pdf,image,word,tools}  vendor/  assets/  docs/  tests/
```
See `docs/architecture.md`.

## Contributing
Keep it vanilla. No runtime CDN, no `innerHTML` with document content, no fake features. Add a tool = one module in `js/tools/` exporting `mount(container, {scope, meta})` plus an entry in `js/registry.js`.

## License
Designed and built by Kennenth. MIT. See `LICENSE` for bundled library licenses.
