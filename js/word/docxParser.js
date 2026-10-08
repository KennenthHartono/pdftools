/**
 * DOCX parser: .docx (a ZIP of XML files) → intermediate representation (IR).
 *
 * The IR is a plain-object tree that knows nothing about PDF:
 *
 *   Document  { sections: Section[], warnings: string[] }
 *   Section   { page: {w, h, top, right, bottom, left}, type, blocks: Block[] }
 *   Paragraph { type:'p', inlines, align, indent, spacing, label, tabs, styleId, ... }
 *   Table     { type:'tbl', grid, rows: [{ cells: [{ blocks, span, vMerge, shade, borders }] }], ... }
 *   Inline    text | tab | br | pagebreak | image
 *
 * Everything Word can do that this converter cannot is recorded in `warnings`
 * rather than silently dropped.
 *
 * Security: document content is only ever read as data (XML text, bytes).
 * Nothing is injected into the DOM and nothing is evaluated.
 */

import { loadFflate } from '../core/lib.js';
import { AppError } from '../core/errors.js';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const MAX_ENTRY_BYTES = 200 * 1024 * 1024;
const TWIP = 1 / 20;

// ───────────────────────── tiny XML helpers (namespace-prefix agnostic) ─────────────────────────

const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const kid = (el, name) => {
  if (!el) return null;
  for (const c of el.children) if (c.localName === name) return c;
  return null;
};
const wAttr = (el, name) => {
  if (!el) return null;
  return el.getAttributeNS(NS_W, name) ?? el.getAttribute(`w:${name}`) ?? el.getAttribute(name);
};
const rAttr = (el, name) => {
  if (!el) return null;
  return el.getAttributeNS(NS_R, name) ?? el.getAttribute(`r:${name}`);
};
/** Boolean "on/off" element: present means true unless w:val is 0/false/off. */
const onOff = (el) => {
  if (!el) return undefined;
  const v = wAttr(el, 'val');
  return !(v === '0' || v === 'false' || v === 'off');
};
const num = (v) => (v == null || v === '' ? undefined : Number(v));

function parseXml(text, partName) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new AppError(`The document is damaged: "${partName}" could not be read.`, { title: 'UNABLE TO READ DOCUMENT', code: 'CORRUPT' });
  }
  return doc;
}

const decoder = new TextDecoder('utf-8');

// ───────────────────────── property parsing ─────────────────────────

/** @returns {Record<string, any>} only the properties that are actually present */
function parseRPr(rPr) {
  const out = {};
  if (!rPr) return out;
  for (const el of rPr.children) {
    switch (el.localName) {
      case 'b': out.bold = onOff(el); break;
      case 'i': out.italic = onOff(el); break;
      case 'u': out.underline = wAttr(el, 'val') !== 'none'; break;
      case 'strike':
      case 'dstrike': out.strike = onOff(el); break;
      case 'caps': out.caps = onOff(el); break;
      case 'smallCaps': out.smallCaps = onOff(el); break;
      case 'vanish': out.vanish = onOff(el); break;
      case 'sz': out.size = num(wAttr(el, 'val')) / 2; break;
      case 'color': {
        const v = wAttr(el, 'val');
        out.color = v && /^[0-9a-f]{6}$/i.test(v) ? v : v === 'auto' ? null : undefined;
        break;
      }
      case 'highlight': {
        const v = wAttr(el, 'val');
        out.highlight = v && v !== 'none' ? v : null;
        break;
      }
      case 'rFonts': out.font = wAttr(el, 'ascii') || wAttr(el, 'hAnsi') || undefined; break;
      case 'vertAlign': out.vertAlign = wAttr(el, 'val'); break;
      case 'rStyle': out.rStyle = wAttr(el, 'val'); break;
      default: break;
    }
  }
  for (const key of Object.keys(out)) if (out[key] === undefined || Number.isNaN(out[key])) delete out[key];
  return out;
}

function parsePPr(pPr) {
  const out = {};
  if (!pPr) return out;
  for (const el of pPr.children) {
    switch (el.localName) {
      case 'pStyle': out.pStyle = wAttr(el, 'val'); break;
      case 'jc': out.align = wAttr(el, 'val'); break;
      case 'ind':
        out.ind = {
          left: num(wAttr(el, 'left') ?? wAttr(el, 'start')),
          right: num(wAttr(el, 'right') ?? wAttr(el, 'end')),
          firstLine: num(wAttr(el, 'firstLine')),
          hanging: num(wAttr(el, 'hanging')),
        };
        break;
      case 'spacing':
        out.spacing = {
          before: num(wAttr(el, 'before')),
          after: num(wAttr(el, 'after')),
          line: num(wAttr(el, 'line')),
          lineRule: wAttr(el, 'lineRule') ?? undefined,
          beforeAuto: ['1', 'true'].includes(wAttr(el, 'beforeAutospacing')),
          afterAuto: ['1', 'true'].includes(wAttr(el, 'afterAutospacing')),
        };
        break;
      case 'numPr':
        out.numPr = { numId: wAttr(kid(el, 'numId'), 'val'), ilvl: num(wAttr(kid(el, 'ilvl'), 'val')) ?? 0 };
        break;
      case 'tabs':
        out.tabs = kids(el, 'tab').map((t) => ({ type: wAttr(t, 'val'), pos: num(wAttr(t, 'pos')), leader: wAttr(t, 'leader') ?? 'none' }));
        break;
      case 'pageBreakBefore': out.pageBreakBefore = onOff(el); break;
      case 'contextualSpacing': out.contextualSpacing = onOff(el); break;
      case 'keepNext': out.keepNext = onOff(el); break;
      case 'pBdr': out.hasBorders = true; break;
      case 'shd': out.hasShading = !!wAttr(el, 'fill') && wAttr(el, 'fill') !== 'auto'; break;
      case 'rPr': out.markRPr = parseRPr(el); break;
      case 'sectPr': out.sectPr = el; break;
      default: break;
    }
  }
  return out;
}

/** Shallow merge that skips undefined, merging `ind`/`spacing` one level deep. */
function mergeProps(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      if ((key === 'ind' || key === 'spacing') && value) {
        out[key] = { ...(out[key] ?? {}) };
        for (const [k, v] of Object.entries(value)) if (v !== undefined && v !== false) out[key][k] = v;
        // booleans like beforeAuto must be able to switch off again
        for (const [k, v] of Object.entries(value)) if (v === false && k.endsWith('Auto')) out[key][k] = false;
      } else out[key] = value;
    }
  }
  return out;
}

// ───────────────────────── fonts / numbering helpers ─────────────────────────

function fontFamilyOf(name) {
  const n = (name ?? '').toLowerCase();
  if (/courier|consolas|mono|menlo|monaco|lucida console|source code|fira code/.test(n)) return 'mono';
  if (/times|georgia|cambria|garamond|palatino|book antiqua|bookman|constantia|century|minion|serif/.test(n) && !/sans/.test(n)) return 'serif';
  return 'sans';
}

function toRoman(n) {
  const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}
function toLetters(n) {
  let out = '';
  while (n > 0) { n--; out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
}
function formatNumber(value, fmt) {
  switch (fmt) {
    case 'lowerLetter': return toLetters(value);
    case 'upperLetter': return toLetters(value).toUpperCase();
    case 'lowerRoman': return toRoman(value);
    case 'upperRoman': return toRoman(value).toUpperCase();
    case 'decimalZero': return String(value).padStart(2, '0');
    default: return String(value);
  }
}

const HIGHLIGHTS = {
  yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000',
  darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000',
  darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000', white: 'FFFFFF',
};

// ───────────────────────── image helpers ─────────────────────────

function imageKind(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57) return 'webp';
  if (b[0] === 0x01 && b[1] === 0x00 && b[2] === 0x00 && b[3] === 0x00) return 'emf';
  if (b[0] === 0xd7 && b[1] === 0xcd) return 'wmf';
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) return 'tiff';
  if (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) return 'tiff';
  const head = decoder.decode(b.subarray(0, 200));
  if (head.includes('<svg') || head.includes('<?xml')) return 'svg';
  return 'unknown';
}

function resolvePath(base, target) {
  const parts = (target.startsWith('/') ? target.slice(1) : base + target).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

// ───────────────────────── main entry ─────────────────────────

/**
 * Parse a .docx file into the IR.
 * @param {File | Blob} file
 * @param {{onProgress?: (info: import('../core/progress.js').ProgressInfo) => void}} [options]
 * @returns {Promise<{sections: any[], warnings: string[]}>}
 */
export async function parseDocx(file, { onProgress } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  onProgress?.({ percent: 2, label: 'Reading', detail: 'Opening the .docx container' });

  // Magic numbers: ZIP = "PK", old Word/encrypted Office = OLE2 compound file.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new AppError('This is an old-format .doc file or a password-protected document. Open it in Word and save it as a regular .docx (without a password), then try again.', { title: 'UNSUPPORTED WORD FORMAT', code: 'UNSUPPORTED' });
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new AppError('This file is not a valid .docx document (it is not a ZIP-based Office file).', { title: 'NOT A VALID DOCX', code: 'CORRUPT' });
  }

  const { unzipSync } = await loadFflate();
  let files;
  try {
    files = unzipSync(bytes, {
      filter: (info) => info.originalSize <= MAX_ENTRY_BYTES && /^(\[Content_Types\]\.xml|word\/(document|styles|numbering|footnotes)\.xml|word\/_rels\/document\.xml\.rels|word\/(header|footer)\d*\.xml|word\/media\/.+)$/.test(info.name),
    });
  } catch (err) {
    throw new AppError('The .docx container is damaged and could not be opened.', { title: 'UNABLE TO READ DOCUMENT', code: 'CORRUPT', cause: err });
  }
  if (!files['word/document.xml']) {
    throw new AppError('This ZIP file does not contain a Word document (word/document.xml is missing).', { title: 'NOT A VALID DOCX', code: 'CORRUPT' });
  }

  const warnings = new Set();
  const warn = (msg) => warnings.add(msg);

  onProgress?.({ percent: 8, label: 'Reading', detail: 'Styles and numbering' });
  const stylesDoc = files['word/styles.xml'] ? parseXml(decoder.decode(files['word/styles.xml']), 'styles.xml') : null;
  const numberingDoc = files['word/numbering.xml'] ? parseXml(decoder.decode(files['word/numbering.xml']), 'numbering.xml') : null;
  const relsDoc = files['word/_rels/document.xml.rels'] ? parseXml(decoder.decode(files['word/_rels/document.xml.rels']), 'document.xml.rels') : null;

  const styles = readStyles(stylesDoc);
  const numbering = readNumbering(numberingDoc);
  const rels = new Map();
  if (relsDoc) for (const rel of relsDoc.documentElement.children) rels.set(rel.getAttribute('Id'), { type: rel.getAttribute('Type') ?? '', target: rel.getAttribute('Target') ?? '', mode: rel.getAttribute('TargetMode') });

  // Headers / footers are not rendered: tell the user if they contained anything.
  for (const [name, data] of Object.entries(files)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(name) && /<w:t[ >]/.test(decoder.decode(data))) {
      warn('Headers and footers (including page numbers) are not rendered by the browser converter.');
      break;
    }
  }

  onProgress?.({ percent: 14, label: 'Reading', detail: 'Document body' });
  const doc = parseXml(decoder.decode(files['word/document.xml']), 'document.xml');
  const body = kid(doc.documentElement, 'body');
  if (!body) throw new AppError('The document has no body text.', { title: 'EMPTY DOCUMENT', code: 'CORRUPT' });

  const ctx = { files, rels, styles, numbering, counters: new Map(), imageCache: new Map(), warn, hasTableStyleWarning: false };
  const sections = parseBody(body, ctx);
  applyContextualSpacing(sections);

  onProgress?.({ percent: 25, label: 'Reading', detail: 'Done' });
  return { sections, warnings: [...warnings] };
}

// ───────────────────────── styles & numbering ─────────────────────────

function readStyles(doc) {
  const table = new Map();
  let defaults = { rPr: {}, pPr: {} };
  let defaultParagraph = null;
  let defaultTable = null;
  if (doc) {
    const root = doc.documentElement;
    const dd = kid(root, 'docDefaults');
    if (dd) defaults = { rPr: parseRPr(kid(kid(dd, 'rPrDefault'), 'rPr')), pPr: parsePPr(kid(kid(dd, 'pPrDefault'), 'pPr')) };
    for (const s of kids(root, 'style')) {
      const id = wAttr(s, 'styleId');
      if (!id) continue;
      const type = wAttr(s, 'type');
      const entry = {
        id,
        type,
        name: wAttr(kid(s, 'name'), 'val') ?? id,
        basedOn: wAttr(kid(s, 'basedOn'), 'val'),
        pPr: parsePPr(kid(s, 'pPr')),
        rPr: parseRPr(kid(s, 'rPr')),
        tblBorders: parseTableBorders(kid(kid(s, 'tblPr'), 'tblBorders')),
      };
      table.set(id, entry);
      if (wAttr(s, 'default') === '1' && type === 'paragraph') defaultParagraph = id;
      if (wAttr(s, 'default') === '1' && type === 'table') defaultTable = id;
    }
  }

  const cache = new Map();
  /** Flatten the basedOn chain (base first). */
  function resolve(id) {
    if (!id || !table.has(id)) return { pPr: {}, rPr: {}, name: '', tblBorders: null };
    if (cache.has(id)) return cache.get(id);
    const seen = new Set();
    const chain = [];
    for (let cur = id; cur && table.has(cur) && !seen.has(cur); cur = table.get(cur).basedOn) {
      seen.add(cur);
      chain.unshift(table.get(cur));
    }
    const merged = {
      pPr: mergeProps(...chain.map((c) => c.pPr)),
      rPr: mergeProps(...chain.map((c) => c.rPr)),
      name: table.get(id).name,
      tblBorders: chain.map((c) => c.tblBorders).filter(Boolean).pop() ?? null,
    };
    cache.set(id, merged);
    return merged;
  }
  return { defaults, defaultParagraph, defaultTable, resolve, has: (id) => table.has(id) };
}

function readNumbering(doc) {
  const abstracts = new Map();
  const nums = new Map();
  if (doc) {
    for (const a of kids(doc.documentElement, 'abstractNum')) {
      const levels = new Map();
      for (const l of kids(a, 'lvl')) {
        levels.set(num(wAttr(l, 'ilvl')) ?? 0, {
          fmt: wAttr(kid(l, 'numFmt'), 'val') ?? 'decimal',
          text: wAttr(kid(l, 'lvlText'), 'val') ?? '',
          start: num(wAttr(kid(l, 'start'), 'val')) ?? 1,
          pPr: parsePPr(kid(l, 'pPr')),
        });
      }
      abstracts.set(wAttr(a, 'abstractNumId'), levels);
    }
    for (const n of kids(doc.documentElement, 'num')) nums.set(wAttr(n, 'numId'), wAttr(kid(n, 'abstractNumId'), 'val'));
  }
  return { abstracts, nums };
}

/** Next list label for a numbered paragraph, or null if the list definition is missing. */
function nextLabel(ctx, numId, ilvl) {
  if (!numId || numId === '0') return null;
  const levels = ctx.numbering.abstracts.get(ctx.numbering.nums.get(numId));
  const def = levels?.get(ilvl);
  if (!def) return null;

  if (def.fmt === 'bullet') return { text: ilvl % 2 === 0 ? '•' : '-', ind: def.pPr.ind };
  if (def.fmt === 'none') return { text: '', ind: def.pPr.ind };

  let counters = ctx.counters.get(numId);
  if (!counters) ctx.counters.set(numId, (counters = []));
  counters[ilvl] = (counters[ilvl] ?? def.start - 1) + 1;
  counters.length = ilvl + 1;

  const text = def.text.replace(/%(\d)/g, (_, d) => {
    const level = Number(d) - 1;
    const levelDef = levels.get(level);
    const value = counters[level] ?? levelDef?.start ?? 1;
    return formatNumber(value, levelDef?.fmt ?? 'decimal');
  });
  return { text, ind: def.pPr.ind };
}

// ───────────────────────── body walking ─────────────────────────

function parseBody(body, ctx) {
  const sections = [];
  let blocks = [];

  const closeSection = (sectPr) => {
    sections.push({ ...readSectPr(sectPr, ctx), blocks });
    blocks = [];
  };

  const walk = (container) => {
    for (const el of container.children) {
      switch (el.localName) {
        case 'p': {
          const p = parseParagraph(el, ctx);
          blocks.push(p.paragraph);
          if (p.sectPr) closeSection(p.sectPr);
          break;
        }
        case 'tbl':
          blocks.push(parseTable(el, ctx));
          break;
        case 'sdt':
          walk(kid(el, 'sdtContent') ?? el);
          break;
        case 'sectPr':
          break; // handled after the loop
        default:
          break;
      }
    }
  };
  walk(body);

  closeSection(kid(body, 'sectPr'));
  // A trailing empty section created by a section-ending last paragraph is harmless but pointless.
  if (sections.length > 1 && !sections[sections.length - 1].blocks.length) sections.pop();
  return sections;
}

function readSectPr(sectPr, ctx) {
  const pgSz = kid(sectPr, 'pgSz');
  const pgMar = kid(sectPr, 'pgMar');
  let w = (num(wAttr(pgSz, 'w')) ?? 11906) * TWIP; // default A4
  let h = (num(wAttr(pgSz, 'h')) ?? 16838) * TWIP;
  if (wAttr(pgSz, 'orient') === 'landscape' && w < h) [w, h] = [h, w];
  const cols = num(wAttr(kid(sectPr, 'cols'), 'num')) ?? 1;
  if (cols > 1) ctx.warn('Multi-column layouts are shown as a single column.');
  const margin = (name, fallback) => (num(wAttr(pgMar, name)) ?? fallback) * TWIP;
  return {
    page: { w, h, top: margin('top', 1440), right: margin('right', 1440), bottom: margin('bottom', 1440), left: margin('left', 1440) },
    type: wAttr(kid(sectPr, 'type'), 'val') ?? 'nextPage',
  };
}

function parseParagraph(pEl, ctx) {
  const direct = parsePPr(kid(pEl, 'pPr'));
  const styleId = direct.pStyle ?? ctx.styles.defaultParagraph;
  const style = ctx.styles.resolve(styleId);

  // Numbering can come from the paragraph itself or from its style.
  const numPr = direct.numPr ?? style.pPr.numPr;
  const numLabel = numPr ? nextLabel(ctx, numPr.numId, numPr.ilvl ?? 0) : null;

  const props = mergeProps(ctx.styles.defaults.pPr, style.pPr, numLabel ? { ind: numLabel.ind } : null, direct);
  if (props.hasBorders) ctx.warn('Paragraph borders are not rendered.');
  if (props.hasShading) ctx.warn('Paragraph shading is not rendered.');

  const headingMatch = /^(?:heading|überschrift|judul)\s*(\d)/i.exec(style.name);
  const isTitle = /^title$/i.test(style.name);
  const baseRPr = mergeProps(ctx.styles.defaults.rPr, style.rPr);
  if (!baseRPr.size && headingMatch) baseRPr.size = [20, 16, 14, 12, 11, 11, 11, 11, 11, 11][Math.min(Number(headingMatch[1]), 9) - 1] ?? 12;
  if (!baseRPr.size && isTitle) baseRPr.size = 26;
  if (baseRPr.bold === undefined && (headingMatch || isTitle)) baseRPr.bold = true;

  const inlines = [];
  const walkRuns = (container, runBase) => {
    for (const el of container.children) {
      switch (el.localName) {
        case 'r':
          parseRun(el, runBase, ctx, inlines);
          break;
        case 'hyperlink':
        case 'ins':
        case 'smartTag':
        case 'fldSimple':
        case 'customXml':
          walkRuns(el, runBase);
          break;
        case 'sdt':
          walkRuns(kid(el, 'sdtContent') ?? el, runBase);
          break;
        case 'oMath':
        case 'oMathPara':
          ctx.warn('Equations are not rendered.');
          break;
        case 'AlternateContent': {
          const choice = kid(el, 'Choice') ?? kid(el, 'Fallback');
          if (choice) walkRuns(choice, runBase);
          break;
        }
        default:
          break; // del, bookmarks, proofErr, comments...: nothing to draw
      }
    }
  };
  walkRuns(pEl, baseRPr);

  const markRPr = mergeProps(baseRPr, props.markRPr);
  const ind = props.ind ?? {};
  const spacing = props.spacing ?? {};
  const toPt = (v, d = 0) => (v ?? d) * TWIP;

  const paragraph = {
    type: 'p',
    styleId,
    inlines,
    align: props.align ?? 'left',
    indent: { left: toPt(ind.left), right: toPt(ind.right), firstLine: toPt(ind.firstLine), hanging: toPt(ind.hanging) },
    spacing: {
      before: spacing.beforeAuto ? 14 : toPt(spacing.before),
      after: spacing.afterAuto ? 14 : toPt(spacing.after),
      line: spacing.line ?? 240,
      lineRule: spacing.lineRule ?? 'auto',
    },
    tabs: (props.tabs ?? []).filter((t) => t.type !== 'clear' && t.pos != null).map((t) => ({ type: t.type === 'right' || t.type === 'end' ? 'right' : t.type === 'center' ? 'center' : 'left', pos: t.pos * TWIP, leader: t.leader })),
    label: numLabel?.text ? { text: numLabel.text } : null,
    pageBreakBefore: !!props.pageBreakBefore,
    contextualSpacing: !!props.contextualSpacing,
    markSize: markRPr.size ?? 11,
    markFont: fontFamilyOf(markRPr.font),
    markBold: !!markRPr.bold,
    markItalic: !!markRPr.italic,
  };
  return { paragraph, sectPr: direct.sectPr ?? null };
}

function parseRun(rEl, paraBase, ctx, out) {
  const direct = parseRPr(kid(rEl, 'rPr'));
  const charStyle = direct.rStyle ? ctx.styles.resolve(direct.rStyle).rPr : null;
  const props = mergeProps(paraBase, charStyle, direct);
  if (props.vanish) return;

  const style = {
    bold: !!props.bold,
    italic: !!props.italic,
    underline: !!props.underline,
    strike: !!props.strike,
    size: props.size ?? 11,
    color: props.color ?? null,
    font: fontFamilyOf(props.font),
    vertAlign: props.vertAlign === 'superscript' || props.vertAlign === 'subscript' ? props.vertAlign : null,
    highlight: props.highlight ? HIGHLIGHTS[props.highlight] ?? null : null,
    caps: !!(props.caps || props.smallCaps),
  };

  const handleChildren = (container) => {
    for (const el of container.children) {
      switch (el.localName) {
        case 't': {
          const text = el.textContent;
          if (text) out.push({ type: 'text', text: style.caps ? text.toUpperCase() : text, style });
          break;
        }
        case 'tab':
          out.push({ type: 'tab' });
          break;
        case 'br': {
          const t = wAttr(el, 'type');
          out.push(t === 'page' ? { type: 'pagebreak' } : { type: 'br' });
          break;
        }
        case 'cr':
          out.push({ type: 'br' });
          break;
        case 'noBreakHyphen':
          out.push({ type: 'text', text: '-', style });
          break;
        case 'sym': {
          const ch = wAttr(el, 'char');
          if (ch && /^F0B7$/i.test(ch)) out.push({ type: 'text', text: '•', style });
          else ctx.warn('Some symbol characters were skipped.');
          break;
        }
        case 'footnoteReference':
        case 'endnoteReference':
          ctx.warn('Footnotes and endnotes are not rendered.');
          break;
        case 'object':
          ctx.warn('Embedded objects (OLE) are not rendered.');
          break;
        case 'drawing':
          parseDrawing(el, ctx, out);
          break;
        case 'pict':
          parseVml(el, ctx, out);
          break;
        case 'AlternateContent': {
          const choice = kid(el, 'Choice') ?? kid(el, 'Fallback');
          if (choice) handleChildren(choice);
          break;
        }
        default:
          break;
      }
    }
  };
  handleChildren(rEl);
}

// ───────────────────────── images ─────────────────────────

function loadImage(rId, ctx) {
  if (!rId) return null;
  if (ctx.imageCache.has(rId)) return ctx.imageCache.get(rId);
  const rel = ctx.rels.get(rId);
  let result = null;
  if (rel && rel.mode !== 'External') {
    const path = resolvePath('word/', rel.target);
    const data = ctx.files[path];
    if (data) result = { name: path.split('/').pop(), data, kind: imageKind(data) };
  }
  ctx.imageCache.set(rId, result);
  return result;
}

function parseDrawing(drawing, ctx, out) {
  const holder = kid(drawing, 'inline') ?? kid(drawing, 'anchor');
  if (!holder) return;
  const extent = kid(holder, 'extent');
  const cx = num(extent?.getAttribute('cx'));
  const cy = num(extent?.getAttribute('cy'));
  const graphicData = kid(kid(holder, 'graphic'), 'graphicData');
  const uri = graphicData?.getAttribute('uri') ?? '';

  if (/picture$/.test(uri)) {
    const blip = kid(kid(kid(graphicData, 'pic'), 'blipFill'), 'blip');
    const image = loadImage(rAttr(blip, 'embed'), ctx);
    if (!image) {
      ctx.warn('An image could not be found inside the document and was skipped.');
      return;
    }
    if (holder.localName === 'anchor') ctx.warn('Floating images are placed inline in the text flow.');
    out.push({ type: 'image', image, w: cx ? cx / 12700 : null, h: cy ? cy / 12700 : null });
  } else if (/chart$/.test(uri)) {
    ctx.warn('Charts are not rendered.');
  } else if (/diagram$/.test(uri)) {
    ctx.warn('SmartArt diagrams are not rendered.');
  } else {
    ctx.warn('Text boxes and drawn shapes are not rendered; their content is skipped.');
  }
}

function parseVml(pict, ctx, out) {
  const all = pict.getElementsByTagName('*');
  let found = false;
  for (const el of all) {
    if (el.localName === 'imagedata') {
      const image = loadImage(rAttr(el, 'id'), ctx);
      if (image) {
        const style = el.parentElement?.getAttribute('style') ?? '';
        const w = /width:\s*([\d.]+)pt/.exec(style);
        const h = /height:\s*([\d.]+)pt/.exec(style);
        out.push({ type: 'image', image, w: w ? Number(w[1]) : null, h: h ? Number(h[1]) : null });
        found = true;
      }
    }
  }
  if (!found) ctx.warn('Text boxes and drawn shapes are not rendered; their content is skipped.');
}

// ───────────────────────── tables ─────────────────────────

function parseBorderEdge(el) {
  if (!el) return undefined;
  const val = wAttr(el, 'val');
  if (!val || val === 'none' || val === 'nil') return null;
  const color = wAttr(el, 'color');
  return { width: Math.max(0.25, (num(wAttr(el, 'sz')) ?? 4) / 8), color: color && /^[0-9a-f]{6}$/i.test(color) ? color : '000000' };
}

function parseTableBorders(el) {
  if (!el) return null;
  return {
    top: parseBorderEdge(kid(el, 'top')),
    bottom: parseBorderEdge(kid(el, 'bottom')),
    left: parseBorderEdge(kid(el, 'left') ?? kid(el, 'start')),
    right: parseBorderEdge(kid(el, 'right') ?? kid(el, 'end')),
    insideH: parseBorderEdge(kid(el, 'insideH')),
    insideV: parseBorderEdge(kid(el, 'insideV')),
  };
}

function parseTable(tbl, ctx) {
  const tblPr = kid(tbl, 'tblPr');
  const styleId = wAttr(kid(tblPr, 'tblStyle'), 'val') ?? ctx.styles.defaultTable;
  const styleName = ctx.styles.resolve(styleId).name;
  const borders = parseTableBorders(kid(tblPr, 'tblBorders')) ?? ctx.styles.resolve(styleId).tblBorders;

  if (styleId && !/^(TableNormal|Normal ?Table|TableGrid|Table ?Grid)$/i.test(styleId) && !/^(table normal|normal table|table grid)$/i.test(styleName) && !ctx.hasTableStyleWarning) {
    // Banding / conditional table styles (e.g. "Grid Table 4 - Accent 1") are not applied.
    if (ctx.styles.has(styleId) && !borders) {
      ctx.warn('Table style colours and banding are simplified; cell content is preserved.');
      ctx.hasTableStyleWarning = true;
    }
  }

  const mar = kid(tblPr, 'tblCellMar');
  const cellMar = {
    top: (num(wAttr(kid(mar, 'top'), 'w')) ?? 0) * TWIP,
    bottom: (num(wAttr(kid(mar, 'bottom'), 'w')) ?? 0) * TWIP,
    left: (num(wAttr(kid(mar, 'left') ?? kid(mar, 'start'), 'w')) ?? 108) * TWIP,
    right: (num(wAttr(kid(mar, 'right') ?? kid(mar, 'end'), 'w')) ?? 108) * TWIP,
  };

  const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => (num(wAttr(c, 'w')) ?? 0) * TWIP);
  const rowsEl = kids(tbl, 'tr');
  const rows = rowsEl.map((tr, rowIndex) => {
    let col = 0;
    const trPr = kid(tr, 'trPr');
    const height = num(wAttr(kid(trPr, 'trHeight'), 'val'));
    const cells = [];
    for (const tc of kids(tr, 'tc')) {
      const tcPr = kid(tc, 'tcPr');
      const span = num(wAttr(kid(tcPr, 'gridSpan'), 'val')) ?? 1;
      const vm = kid(tcPr, 'vMerge');
      const vMerge = vm ? (wAttr(vm, 'val') === 'restart' ? 'restart' : 'continue') : null;
      const shdFill = wAttr(kid(tcPr, 'shd'), 'fill');
      const tcBorders = parseTableBorders(kid(tcPr, 'tcBorders'));
      const width = num(wAttr(kid(tcPr, 'tcW'), 'w'));

      const blocks = [];
      const walkCell = (container) => {
        for (const el of container.children) {
          if (el.localName === 'p') {
            const { paragraph } = parseParagraph(el, ctx);
            blocks.push(paragraph);
          } else if (el.localName === 'tbl') blocks.push(parseTable(el, ctx));
          else if (el.localName === 'sdt') walkCell(kid(el, 'sdtContent') ?? el);
        }
      };
      walkCell(tc);
      if (!blocks.length) blocks.push(emptyParagraph());

      cells.push({
        blocks,
        span,
        gridStart: col,
        vMerge,
        shade: shdFill && /^[0-9a-f]{6}$/i.test(shdFill) ? shdFill : null,
        borders: tcBorders,
        widthPt: width ? width * TWIP : null,
      });
      col += span;
    }
    return { cells, height: height ? height * TWIP : 0, rowIndex };
  });

  // Make sure we have a grid even if <w:tblGrid> is missing.
  const columns = Math.max(grid.length, ...rows.map((r) => r.cells.reduce((s, c) => s + c.span, 0)), 1);
  while (grid.length < columns) grid.push(0);

  return { type: 'tbl', grid, rows, borders, cellMar };
}

function emptyParagraph() {
  return {
    type: 'p', styleId: null, inlines: [], align: 'left',
    indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
    spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
    tabs: [], label: null, pageBreakBefore: false, contextualSpacing: false,
    markSize: 11, markFont: 'sans', markBold: false, markItalic: false,
  };
}

/** "Don't add space between paragraphs of the same style" (used by list styles). */
function applyContextualSpacing(sections) {
  const visit = (blocks) => {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'tbl') {
        for (const row of b.rows) for (const cell of row.cells) visit(cell.blocks);
        continue;
      }
      const next = blocks[i + 1];
      if (next?.type === 'p' && b.contextualSpacing && next.contextualSpacing && b.styleId === next.styleId) {
        b.spacing.after = 0;
        next.spacing.before = 0;
      }
    }
  };
  for (const s of sections) visit(s.blocks);
}
