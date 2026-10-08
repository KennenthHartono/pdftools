/**
 * The tool catalogue: one entry per tool. Adding a tool = adding an entry and a module.
 * Tool modules are imported lazily, only when the user opens them.
 */

import { LIMITATIONS } from './word/limitations.js';

/**
 * @typedef {object} ToolDef
 * @property {string} id         URL fragment: #/<id>
 * @property {string} num        "01" … "08"
 * @property {string} title
 * @property {string} short      Card text
 * @property {string} description Tool page intro
 * @property {string} formats    Card footer, e.g. "PDF → JPG / PNG"
 * @property {string[]} badges   Format badges on the tool page
 * @property {string} icon
 * @property {boolean} [featured]
 * @property {{label: string, text: string}} [note]
 * @property {() => Promise<{mount: Function}>} load
 */

/** @type {ToolDef[]} */
export const TOOLS = [
  {
    id: 'pdf-to-images',
    num: '01',
    title: 'PDF → IMAGES',
    short: 'Convert PDF pages into JPG or PNG images.',
    description: 'Render selected pages or the whole document as JPG or PNG, then download them one by one or as a ZIP.',
    formats: 'PDF → JPG / PNG',
    badges: ['PDF', 'JPG', 'PNG'],
    icon: 'pdf-to-images',
    load: () => import('./tools/pdfToImagesTool.js'),
  },
  {
    id: 'merge-pdf',
    num: '02',
    title: 'PDF MERGER',
    short: 'Combine several PDFs into one, in the order you choose.',
    description: 'Add PDFs, drag them into order, and join them into a single file.',
    formats: 'PDF + PDF → PDF',
    badges: ['PDF'],
    icon: 'merge',
    load: () => import('./tools/mergeTool.js'),
  },
  {
    id: 'split-pdf',
    num: '03',
    title: 'PDF SPLITTER',
    short: 'Split by page, by range, or extract selected pages.',
    description: 'Create one PDF per page, one per range such as 1-3, 5, 8-10, or a single PDF from the pages you pick.',
    formats: 'PDF → PDF / ZIP',
    badges: ['PDF', 'ZIP'],
    icon: 'split',
    load: () => import('./tools/splitTool.js'),
  },
  {
    id: 'rotate-pdf',
    num: '04',
    title: 'ROTATE PDF',
    short: 'Turn all pages, or only the ones you select.',
    description: 'Rotate pages by 90°, 180° or 270° and check the result on thumbnails before saving.',
    formats: 'PDF → PDF',
    badges: ['PDF'],
    icon: 'rotate',
    load: () => import('./tools/rotateTool.js'),
  },
  {
    id: 'images-to-pdf',
    num: '05',
    title: 'IMAGES → PDF',
    short: 'Turn photos and scans into a single PDF.',
    description: 'Put images on A4, Letter or original-size pages with your own margin, orientation and fit.',
    formats: 'JPG / PNG / WEBP → PDF',
    badges: ['JPG', 'PNG', 'WEBP'],
    icon: 'images-to-pdf',
    load: () => import('./tools/imagesToPdfTool.js'),
  },
  {
    id: 'compress-pdf',
    num: '06',
    title: 'COMPRESS PDF',
    short: 'Reduce file size. Results depend on what is inside.',
    description: 'Basic mode re-saves the file without touching its content. Balanced and Maximum rebuild pages as compressed images.',
    formats: 'PDF → smaller PDF',
    badges: ['PDF'],
    icon: 'compress',
    note: { label: 'HONEST NOTE', text: 'Compression is never guaranteed. Basic mode is non-destructive but often saves little. Balanced and Maximum are lossy and turn text into images.' },
    load: () => import('./tools/compressTool.js'),
  },
  {
    id: 'word-to-pdf',
    num: '07',
    title: 'WORD → PDF',
    short: 'Convert .docx files to PDF inside your browser.',
    description: 'A built-in converter reads the .docx and draws it as a PDF. Add several files to get one PDF each.',
    formats: 'DOCX → PDF',
    badges: ['DOCX', 'PDF'],
    icon: 'word-to-pdf',
    note: { label: 'LIMITATIONS', text: LIMITATIONS.join(' ') },
    load: () => import('./tools/wordToPdfTool.js'),
  },
  {
    id: 'word-batch',
    num: '08',
    title: 'WORD → ONE PDF',
    short: 'Convert many .docx files and merge them into one PDF.',
    description: 'Convert each document in turn, then join the results into a single PDF in the order you set. A failing file never stops the rest.',
    formats: 'DOCX × N → ONE PDF',
    badges: ['DOCX', 'PDF'],
    icon: 'word-batch',
    featured: true,
    note: { label: 'LIMITATIONS', text: LIMITATIONS.join(' ') },
    load: () => import('./tools/wordBatchTool.js'),
  },
];

export const findTool = (id) => TOOLS.find((t) => t.id === id);
