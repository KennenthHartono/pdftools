/** Plain-text list of what the browser DOCX converter can and cannot do. Shown in the UI and the docs. */
export const LIMITATIONS = [
  'Layout is approximate: Word fonts are replaced by Helvetica / Times / Courier, so line and page breaks can differ from Word.',
  'Supported: paragraphs, headings, bold / italic / underline / strike, colours, alignment, lists, tabs, tables, images, page breaks.',
  'Not rendered: headers and footers, footnotes, text boxes, charts, equations, columns, floating image positions.',
  'Only Latin-script text is supported; other scripts are replaced by "?".',
];
