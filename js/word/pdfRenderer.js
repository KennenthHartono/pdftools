/**
 * IR → PDF renderer: a small layout engine on top of pdf-lib.
 *
 * Pipeline:  embed images → lay blocks out into "boxes" → paginate → draw.
 *
 * Boxes are the unit of pagination:
 *   { kind, before, after, height, draw(page, x, topY), split?(availableHeight) }
 *   - 'p'         paragraph (splittable between lines)
 *   - 'row'       table row (splittable between cell lines)
 *   - 'pagebreak' forced break
 *
 * Honest limits (also listed in the README and shown to users as warnings):
 *   - Only the 14 standard PDF fonts are used (Helvetica / Times / Courier).
 *     Word's actual fonts are mapped to the closest of these, so line breaks
 *     and page counts can differ from Word. Characters outside the Latin
 *     range are replaced with "?".
 *   - No headers/footers, footnotes, text boxes, charts, equations.
 */

import { loadPdfLib } from '../core/lib.js';
import { createPdfDocument, savePdf } from '../pdf/pdfDocument.js';
import { canvasToBlob } from '../pdf/pdfRender.js';
import { releaseCanvas } from '../core/memory.js';
import { throwIfAborted } from '../core/errors.js';
import { yieldToBrowser } from '../core/utils.js';

const LINE_FACTOR = 1.15; // natural line height as a multiple of font size
const DESCENT = 0.245; // part of a natural line below the baseline
const DEFAULT_TAB = 36; // 0.5 inch
const EPS = 0.05;

const CHAR_MAP = {
  '‐': '-', '‑': '-', '‒': '-', '−': '-', '­': '', '​': '', '‌': '', '‍': '', '﻿': '',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '→': '->', '←': '<-', '●': '•', '': '•', '✓': 'v',
};

/**
 * @param {{sections: any[], warnings: string[]}} ir
 * @param {{onProgress?: (info: import('../core/progress.js').ProgressInfo) => void, signal?: AbortSignal}} [options]
 * @returns {Promise<{bytes: Uint8Array, pageCount: number, warnings: string[]}>}
 */
export async function renderToPdf(ir, { onProgress, signal } = {}) {
  const lib = await loadPdfLib();
  const { StandardFonts, rgb } = lib;
  const doc = await createPdfDocument();
  const warnings = new Set(ir.warnings);
  const replacedChars = new Set();
  let replacedCount = 0;

  // ── fonts: embed only the variants the document uses ──────────────────────
  const FONT_NAMES = {
    sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
    serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
    mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  };
  const fontEntries = new Map();
  const fontIdx = (family, bold, italic) => `${family}:${(bold ? 1 : 0) + (italic ? 2 : 0)}`;
  const neededFonts = new Set([fontIdx('sans', false, false)]);
  forEachInline(ir.sections, (inl) => {
    if (inl.type === 'text') neededFonts.add(fontIdx(inl.style.font, inl.style.bold, inl.style.italic));
  });
  forEachParagraph(ir.sections, (p) => neededFonts.add(fontIdx(p.markFont, p.markBold, p.markItalic)));
  for (const key of neededFonts) {
    const [family, variant] = key.split(':');
    const font = await doc.embedFont(FONT_NAMES[family][Number(variant)]);
    fontEntries.set(key, { font, supported: new Set(font.getCharacterSet()) });
  }
  const fontOf = (family, bold, italic) => fontEntries.get(fontIdx(family, bold, italic)) ?? fontEntries.get(fontIdx('sans', false, false));

  const colorCache = new Map();
  const colorOf = (hex) => {
    const key = hex ?? '000000';
    if (!colorCache.has(key)) colorCache.set(key, rgb(parseInt(key.slice(0, 2), 16) / 255, parseInt(key.slice(2, 4), 16) / 255, parseInt(key.slice(4, 6), 16) / 255));
    return colorCache.get(key);
  };

  /** Make text safe for the standard fonts (they only cover Latin-1 / WinAnsi). */
  function clean(text, entry) {
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp < 32 || cp === 0x7f) continue;
      if (entry.supported.has(cp)) out += ch;
      else if (ch in CHAR_MAP) out += CHAR_MAP[ch];
      else {
        out += '?';
        replacedCount++;
        if (replacedChars.size < 6) replacedChars.add(ch);
      }
    }
    return out;
  }

  // ── images: embed first so layout knows their size ────────────────────────
  onProgress?.({ percent: 26, label: 'Preparing', detail: 'Embedding images' });
  const embedded = new Map();
  let unsupportedImages = 0;
  const imageInlines = [];
  forEachInline(ir.sections, (inl) => {
    if (inl.type === 'image') imageInlines.push(inl);
  });
  for (const inl of imageInlines) {
    throwIfAborted(signal);
    let pdfImage = embedded.get(inl.image);
    if (pdfImage === undefined) {
      pdfImage = await embedImage(doc, inl.image);
      embedded.set(inl.image, pdfImage);
    }
    if (!pdfImage) {
      unsupportedImages++;
      Object.assign(inl, { type: 'text', text: '[image not supported]', style: { bold: false, italic: true, underline: false, strike: false, size: 9, color: '888888', font: 'sans', vertAlign: null, highlight: null, caps: false } });
      continue;
    }
    inl.pdfImage = pdfImage;
    inl.w ??= pdfImage.width * 0.75;
    inl.h ??= pdfImage.height * 0.75;
    if (!inl.h && inl.w) inl.h = (inl.w * pdfImage.height) / pdfImage.width;
  }
  if (unsupportedImages) warnings.add(`${unsupportedImages} image${unsupportedImages === 1 ? '' : 's'} in unsupported formats (for example EMF/WMF) ${unsupportedImages === 1 ? 'was' : 'were'} replaced with a placeholder.`);

  // ── layout helpers ────────────────────────────────────────────────────────

  function styleOf(s) {
    const entry = fontOf(s.font, s.bold, s.italic);
    const size = s.vertAlign ? s.size * 0.65 : s.size;
    const rise = s.vertAlign === 'superscript' ? s.size * 0.35 : s.vertAlign === 'subscript' ? -s.size * 0.12 : 0;
    return { entry, size, rise, color: s.color, underline: s.underline, strike: s.strike, highlight: s.highlight, key: `${s.font}${s.bold}${s.italic}|${size}|${s.color}|${s.underline}|${s.strike}|${rise}|${s.highlight}` };
  }

  /** Turn a paragraph's inlines into measured tokens. */
  function tokenize(inlines, maxImageW, maxImageH) {
    const tokens = [];
    for (const inl of inlines) {
      if (inl.type === 'text') {
        const st = styleOf(inl.style);
        for (const piece of inl.text.split(/([ \t\n\r]+)/)) {
          if (!piece) continue;
          if (/^[ \t\n\r]+$/.test(piece)) {
            // Literal tabs/newlines are rare inside <w:t>, but handle them anyway.
            let spaces = 0;
            const flush = () => {
              if (spaces) {
                const text = ' '.repeat(spaces);
                tokens.push({ k: 'space', text, st, w: st.entry.font.widthOfTextAtSize(text, st.size) });
                spaces = 0;
              }
            };
            for (const ch of piece) {
              if (ch === '\t') { flush(); tokens.push({ k: 'tab' }); }
              else if (ch === '\n' || ch === '\r') { flush(); }
              else spaces++;
            }
            flush();
          } else {
            const text = clean(piece, st.entry);
            if (text) tokens.push({ k: 'word', text, st, w: st.entry.font.widthOfTextAtSize(text, st.size) });
          }
        }
      } else if (inl.type === 'tab') tokens.push({ k: 'tab' });
      else if (inl.type === 'br') tokens.push({ k: 'br' });
      else if (inl.type === 'image') {
        let w = inl.w;
        let h = inl.h;
        const scale = Math.min(1, maxImageW / w, maxImageH / h);
        w *= scale;
        h *= scale;
        tokens.push({ k: 'image', img: inl.pdfImage, w, h });
      }
    }
    return tokens;
  }

  /** Greedy line breaking with tabs, indents and alignment. */
  function layoutParagraphSegment(p, inlines, width, { withLabel, maxH }) {
    const tokens = tokenize(inlines, Math.max(20, width - p.indent.right - p.indent.left), maxH);
    const L = p.indent.left;
    const hang = p.indent.hanging;
    const rightLimit = width - p.indent.right;
    const markEntry = fontOf(p.markFont, p.markBold, p.markItalic);

    // Numbered / bulleted label
    let labelInfo = null;
    let firstStart = Math.max(0, L + p.indent.firstLine - hang);
    if (withLabel && p.label) {
      const text = clean(p.label.text, markEntry);
      const labelW = markEntry.font.widthOfTextAtSize(text, p.markSize);
      const labelX = Math.max(0, L - hang);
      labelInfo = { text, x: labelX, entry: markEntry, size: p.markSize };
      firstStart = Math.max(L, labelX + labelW + 4);
    }

    // Tab stops: custom ones, plus an implicit stop at the hanging indent.
    const stops = [...p.tabs];
    if (hang > 0) stops.push({ type: 'left', pos: L, leader: 'none' });
    stops.sort((a, b) => a.pos - b.pos);
    const nextStop = (x) => {
      const custom = stops.find((s) => s.pos > x + 0.5);
      if (custom) return custom;
      const from = Math.max(x, stops.length ? stops[stops.length - 1].pos : 0);
      return { type: 'left', pos: (Math.floor((from + 0.5) / DEFAULT_TAB) + 1) * DEFAULT_TAB, leader: 'none' };
    };

    const lines = [];
    let cur = { items: [], x: firstStart, start: firstStart, wrapped: false };
    const hasContent = (line) => line.items.some((i) => i.k !== 'space');
    const trimTrailing = (line) => {
      while (line.items.length && line.items[line.items.length - 1].k === 'space') line.items.pop();
    };
    const pushLine = (hard) => {
      trimTrailing(cur);
      cur.hard = hard;
      lines.push(cur);
      cur = { items: [], x: L, start: L, wrapped: !hard };
    };

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.k === 'br') {
        pushLine(true);
        continue;
      }
      if (t.k === 'tab') {
        const stop = nextStop(cur.x);
        let w;
        if (stop.pos > rightLimit + EPS) {
          w = Math.max(0, rightLimit - cur.x);
        } else if (stop.type === 'left') {
          w = stop.pos - cur.x;
        } else {
          let seg = 0;
          for (let j = i + 1; j < tokens.length && tokens[j].k !== 'tab' && tokens[j].k !== 'br'; j++) seg += tokens[j].w;
          w = Math.max(0, stop.type === 'right' ? stop.pos - cur.x - seg : stop.pos - cur.x - seg / 2);
        }
        cur.items.push({ k: 'tab', x: cur.x, w, leader: stop.leader });
        cur.x += w;
        continue;
      }
      if (t.k === 'space') {
        if (cur.wrapped && !cur.items.length) continue; // no leading spaces after a soft wrap
        cur.items.push({ ...t, x: cur.x });
        cur.x += t.w;
        continue;
      }

      // word or image
      if (cur.x + t.w > rightLimit + EPS && hasContent(cur)) pushLine(false);

      if (cur.x + t.w > rightLimit + EPS) {
        const room = Math.max(10, rightLimit - cur.x);
        if (t.k === 'image') {
          const s = room / t.w;
          cur.items.push({ ...t, w: t.w * s, h: t.h * s, x: cur.x });
          cur.x += t.w * s;
          continue;
        }
        // A single word wider than the line: split it by characters.
        let rest = t.text;
        let first = true;
        while (rest) {
          const avail = first ? room : Math.max(10, rightLimit - L);
          let n = 1;
          while (n < rest.length && t.st.entry.font.widthOfTextAtSize(rest.slice(0, n + 1), t.st.size) <= avail) n++;
          const chunk = rest.slice(0, n);
          const cw = t.st.entry.font.widthOfTextAtSize(chunk, t.st.size);
          cur.items.push({ k: 'word', text: chunk, st: t.st, w: cw, x: cur.x });
          cur.x += cw;
          rest = rest.slice(n);
          if (rest) pushLine(false);
          first = false;
        }
        continue;
      }
      cur.items.push({ ...t, x: cur.x });
      cur.x += t.w;
    }
    pushLine(true);
    // pushLine(true) after the final content marks the last line as "hard" for justification purposes.
    lines[lines.length - 1].last = true;

    // Line metrics, alignment, justification
    const mult = p.spacing.lineRule === 'auto' ? p.spacing.line / 240 : 1;
    const exact = p.spacing.lineRule === 'exact' ? p.spacing.line / 20 : null;
    const atLeast = p.spacing.lineRule === 'atLeast' ? p.spacing.line / 20 : 0;
    const justify = p.align === 'both' || p.align === 'distribute';

    for (const line of lines) {
      let maxSize = 0;
      let imgH = 0;
      for (const it of line.items) {
        if (it.k === 'word' || it.k === 'space') maxSize = Math.max(maxSize, it.st.size);
        else if (it.k === 'image') imgH = Math.max(imgH, it.h);
      }
      if (!maxSize) maxSize = imgH ? p.markSize * 0.8 : p.markSize;
      const descent = maxSize * DESCENT;
      const natural = Math.max(maxSize * (LINE_FACTOR - DESCENT), imgH) + descent;
      let H = natural * mult;
      if (exact != null) H = exact;
      else if (atLeast) H = Math.max(natural, atLeast);
      line.h = H;
      line.base = H - descent; // baseline distance from the top of the line box

      const end = line.items.length ? line.items[line.items.length - 1].x + line.items[line.items.length - 1].w : line.start;
      line.end = end;
      line.shift = 0;
      const free = rightLimit - end;
      const hasTab = line.items.some((i) => i.k === 'tab');
      if (justify && !line.hard && !line.last && !hasTab) {
        const gaps = line.items.filter((i, idx) => i.k === 'space' && idx > 0).length;
        if (gaps && free > 0) {
          const extra = free / gaps;
          let x = line.start;
          for (const it of line.items) {
            it.x = x;
            x += it.w + (it.k === 'space' ? extra : 0);
          }
          line.justified = true;
        }
      } else if (p.align === 'center') line.shift = Math.max(0, free / 2);
      else if (p.align === 'right' || p.align === 'end') line.shift = Math.max(0, free);
    }

    const height = lines.reduce((s, l) => s + l.h, 0);
    return makeParagraphBox({ lines, labelInfo, before: p.spacing.before, after: p.spacing.after, height });
  }

  /** Paragraph box with line-level splitting (orphan/widow aware). */
  function makeParagraphBox({ lines, labelInfo, before, after, height, breakBefore = false }) {
    return {
      kind: 'p',
      before,
      after,
      height,
      breakBefore,
      split(avail, atTop) {
        let used = 0;
        let n = 0;
        while (n < lines.length && used + lines[n].h <= avail + EPS) used += lines[n++].h;
        if (n === 0) return atTop ? this.forceSplit(1) : null;
        if (n === lines.length) return null;
        // Orphan/widow control: never leave one line alone on either page.
        if (n === 1 && lines.length > 2 && !atTop) return null;
        if (lines.length - n === 1 && n > 2) n--;
        return this.forceSplit(n);
      },
      forceSplit(n) {
        const headLines = lines.slice(0, n);
        const tailLines = lines.slice(n);
        const hh = headLines.reduce((s, l) => s + l.h, 0);
        return {
          head: makeParagraphBox({ lines: headLines, labelInfo, before, after: 0, height: hh, breakBefore }),
          tail: makeParagraphBox({ lines: tailLines, labelInfo: null, before: 0, after, height: height - hh }),
        };
      },
      draw(page, x, topY) {
        let y = topY;
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          const base = y - line.base;
          if (li === 0 && labelInfo?.text) {
            page.drawText(labelInfo.text, { x: x + labelInfo.x, y: base, size: labelInfo.size, font: labelInfo.entry.font, color: colorOf(null) });
          }
          drawLine(page, line, x, base);
          y -= line.h;
        }
      },
    };
  }

  function drawLine(page, line, x0, baseY) {
    const x = x0 + line.shift;

    // Group consecutive word/space items that share a style (for background, text and decorations).
    const runs = [];
    for (const it of line.items) {
      if (it.k !== 'word' && it.k !== 'space') {
        runs.push(null); // break run groups at tabs/images
        continue;
      }
      const last = runs[runs.length - 1];
      if (last && last.key === it.st.key && !line.justified) {
        last.items.push(it);
        last.end = it.x + it.w;
      } else if (last && last.key === it.st.key && line.justified) {
        last.items.push(it);
        last.end = it.x + it.w;
      } else runs.push({ key: it.st.key, st: it.st, items: [it], start: it.x, end: it.x + it.w });
    }

    for (const run of runs) {
      if (!run) continue;
      // trim trailing spaces from decoration extents
      let end = run.end;
      for (let i = run.items.length - 1; i >= 0 && run.items[i].k === 'space'; i--) end -= run.items[i].w;
      const { st } = run;
      if (st.highlight && end > run.start) {
        page.drawRectangle({ x: x + run.start, y: baseY - st.size * 0.22 + st.rise, width: end - run.start, height: st.size * 1.12, color: colorOf(st.highlight) });
      }
    }

    for (const it of line.items) {
      if (it.k === 'image') {
        page.drawImage(it.img, { x: x + it.x, y: baseY, width: it.w, height: it.h });
      } else if (it.k === 'tab' && it.leader && it.leader !== 'none' && it.w > 8) {
        drawLeader(page, it, x, baseY, line);
      }
    }

    for (const run of runs) {
      if (!run) continue;
      const { st } = run;
      if (line.justified) {
        for (const it of run.items) if (it.k === 'word') page.drawText(it.text, { x: x + it.x, y: baseY + st.rise, size: st.size, font: st.entry.font, color: colorOf(st.color) });
      } else {
        const text = run.items.map((i) => i.text).join('').trimEnd();
        if (text) page.drawText(text, { x: x + run.start, y: baseY + st.rise, size: st.size, font: st.entry.font, color: colorOf(st.color) });
      }
      let end = run.end;
      for (let i = run.items.length - 1; i >= 0 && run.items[i].k === 'space'; i--) end -= run.items[i].w;
      if (end <= run.start) continue;
      const thickness = Math.max(0.4, st.size * 0.05);
      if (st.underline) page.drawLine({ start: { x: x + run.start, y: baseY + st.rise - st.size * 0.12 }, end: { x: x + end, y: baseY + st.rise - st.size * 0.12 }, thickness, color: colorOf(st.color) });
      if (st.strike) page.drawLine({ start: { x: x + run.start, y: baseY + st.rise + st.size * 0.28 }, end: { x: x + end, y: baseY + st.rise + st.size * 0.28 }, thickness, color: colorOf(st.color) });
    }
  }

  function drawLeader(page, tab, x, baseY, line) {
    const prev = [...line.items].reverse().find((i) => i.x < tab.x && (i.k === 'word' || i.k === 'space'));
    const st = prev?.st ?? styleOf({ font: 'sans', bold: false, italic: false, size: 11, vertAlign: null, color: null, underline: false, strike: false, highlight: null });
    const ch = tab.leader === 'hyphen' ? '-' : tab.leader === 'underscore' ? '_' : tab.leader === 'middleDot' ? '·' : '.';
    const glyph = clean(ch, st.entry) || '.';
    const gw = st.entry.font.widthOfTextAtSize(glyph, st.size);
    const pitch = ch === '.' || ch === '·' ? gw * 2.2 : gw;
    const n = Math.floor((tab.w - 2) / pitch);
    if (n < 1) return;
    let px = x + tab.x + tab.w - n * pitch;
    const text = glyph.padEnd(1);
    for (let i = 0; i < n; i++, px += pitch) page.drawText(text, { x: px, y: baseY, size: st.size, font: st.entry.font, color: colorOf(st.color) });
  }

  /** One paragraph → boxes (more than one if it contains manual page breaks). */
  function layoutParagraph(p, width, geom) {
    const segments = [[]];
    for (const inl of p.inlines) {
      if (inl.type === 'pagebreak') segments.push([]);
      else segments[segments.length - 1].push(inl);
    }
    const boxes = [];
    segments.forEach((seg, i) => {
      if (i > 0) boxes.push({ kind: 'pagebreak' });
      const isLast = i === segments.length - 1;
      const keep = seg.length > 0 || segments.length === 1;
      if (!keep) return;
      const box = layoutParagraphSegment(p, seg, width, { withLabel: i === 0, maxH: geom.contentH - 4 });
      if (i > 0) box.before = 0;
      if (!isLast) box.after = 0;
      if (i === 0 && p.pageBreakBefore) box.breakBefore = true;
      boxes.push(box);
    });
    return boxes;
  }

  // ── tables ────────────────────────────────────────────────────────────────

  /** Take as many boxes as fit into `avail` points, splitting the last one if possible. */
  function fillColumn(boxes, avail) {
    let used = 0;
    const taken = [];
    const rest = boxes.slice();
    while (rest.length) {
      const box = rest[0];
      const before = taken.length ? box.before : 0;
      if (used + before + box.height <= avail + EPS) {
        taken.push(taken.length ? box : { ...box, before: 0 });
        used += before + box.height + box.after;
        rest.shift();
        continue;
      }
      const part = box.split?.(avail - used - before, taken.length === 0);
      if (part) {
        taken.push(taken.length ? part.head : { ...part.head, before: 0 });
        used += before + part.head.height;
        rest[0] = part.tail;
      }
      break;
    }
    return { taken, rest, used };
  }

  const columnHeight = (boxes) => boxes.reduce((s, b) => s + b.before + b.height + b.after, 0);

  function makeRowBox(cells, minHeight, pad) {
    const height = Math.max(minHeight, ...cells.map((c) => columnHeight(c.boxes) + pad.top + pad.bottom), pad.top + pad.bottom);
    return {
      kind: 'row',
      before: 0,
      after: 0,
      height,
      cells,
      split(avail) {
        const inner = avail - pad.top - pad.bottom;
        if (inner <= 0) return null;
        const parts = cells.map((c) => fillColumn(c.boxes, inner));
        if (parts.every((p) => p.taken.length === 0)) return null;
        if (parts.every((p) => p.rest.length === 0)) return null;
        const head = makeRowBox(cells.map((c, i) => ({ ...c, boxes: parts[i].taken })), 0, pad);
        const tail = makeRowBox(cells.map((c, i) => ({ ...c, boxes: parts[i].rest.map((b, k) => (k === 0 ? { ...b, before: 0 } : b)), shade: c.shade })), 0, pad);
        return { head, tail };
      },
      draw(page, x, topY) {
        for (const c of cells) {
          if (c.shade) page.drawRectangle({ x: x + c.x, y: topY - height, width: c.w, height, color: colorOf(c.shade) });
        }
        for (const c of cells) {
          let y = topY - pad.top;
          for (const b of c.boxes) {
            y -= b.before;
            b.draw(page, x + c.x + pad.left, y);
            y -= b.height + b.after;
          }
        }
        for (const c of cells) {
          const edge = (b, x1, y1, x2, y2) => {
            if (b) page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: b.width, color: colorOf(b.color) });
          };
          const left = x + c.x;
          const right = left + c.w;
          edge(c.borders.top, left, topY, right, topY);
          edge(c.borders.bottom, left, topY - height, right, topY - height);
          edge(c.borders.left, left, topY, left, topY - height);
          edge(c.borders.right, right, topY, right, topY - height);
        }
      },
    };
  }

  function layoutTable(tbl, width, geom) {
    const pad = tbl.cellMar;
    let grid = tbl.grid.slice();
    const sum = grid.reduce((s, v) => s + v, 0);
    if (sum <= 0) grid = grid.map(() => width / grid.length);
    else if (sum > width + 0.5) grid = grid.map((v) => (v * width) / sum);
    else if (grid.some((v) => v <= 0)) {
      const zeros = grid.filter((v) => v <= 0).length;
      const fill = Math.max(10, (width - sum) / zeros);
      grid = grid.map((v) => (v > 0 ? v : fill));
    }
    const colX = [0];
    for (const w of grid) colX.push(colX[colX.length - 1] + w);
    const lastRow = tbl.rows.length - 1;
    const lastCol = grid.length - 1;
    const T = tbl.borders ?? {};
    const pick = (own, fallback) => (own !== undefined ? own : fallback ?? null);

    return tbl.rows.map((row, r) => {
      const nextRow = tbl.rows[r + 1];
      const cells = row.cells.map((cell) => {
        const c0 = cell.gridStart;
        const c1 = Math.min(lastCol, c0 + cell.span - 1);
        const x = colX[Math.min(c0, lastCol)];
        const w = Math.max(10, colX[c1 + 1] - x);
        const innerW = Math.max(10, w - pad.left - pad.right);
        const boxes = layoutBlocks(cell.blocks, innerW, geom).filter((b) => b.kind !== 'pagebreak');
        const own = cell.borders ?? {};
        const borders = {
          top: cell.vMerge === 'continue' ? null : pick(own.top, r === 0 ? T.top : T.insideH),
          bottom: pick(own.bottom, r === lastRow ? T.bottom : T.insideH),
          left: pick(own.left, c0 === 0 ? T.left : T.insideV),
          right: pick(own.right, c1 === lastCol ? T.right : T.insideV),
        };
        if (nextRow?.cells.some((n) => n.vMerge === 'continue' && n.gridStart === c0)) borders.bottom = null;
        return { x, w, boxes, shade: cell.shade, borders };
      });
      return makeRowBox(cells, row.height, pad);
    });
  }

  function layoutBlocks(blocks, width, geom) {
    const boxes = [];
    for (const block of blocks) {
      if (block.type === 'p') boxes.push(...layoutParagraph(block, width, geom));
      else boxes.push(...layoutTable(block, width, geom));
    }
    return boxes;
  }

  // ── pagination ────────────────────────────────────────────────────────────

  const state = { page: null, y: 0, atTop: true, suppress: false, geom: null };

  function newPage(geom) {
    state.page = doc.addPage([geom.w, geom.h]);
    state.y = geom.h - geom.top;
    state.atTop = true;
  }

  function place(boxes, geom) {
    const queue = boxes.slice();
    const draw = (box, before) => {
      box.draw(state.page, geom.left, state.y - before);
      state.y -= before + box.height + box.after;
      state.atTop = false;
      state.suppress = false;
    };
    while (queue.length) {
      const box = queue.shift();
      if (box.kind === 'pagebreak') {
        if (!state.page) newPage(geom); // a break on an empty start still yields a blank page, as in Word
        state.page = null;
        state.suppress = false;
        continue;
      }
      if (box.breakBefore && state.page && !state.atTop) state.page = null;
      if (!state.page) newPage(geom);

      const before = state.atTop && state.suppress ? 0 : box.before;
      const avail = state.y - geom.bottom;
      if (before + box.height <= avail + EPS) {
        draw(box, before);
        continue;
      }
      const part = box.split?.(Math.max(0, avail - before), state.atTop);
      if (part) {
        draw(part.head, before);
        queue.unshift(part.tail);
        state.page = null;
        state.suppress = true;
        continue;
      }
      if (state.atTop) {
        draw(box, before); // cannot fit even on an empty page: draw anyway rather than loop forever
        continue;
      }
      state.page = null;
      state.suppress = true;
      queue.unshift(box);
    }
  }

  // ── run ───────────────────────────────────────────────────────────────────

  const totalBlocks = Math.max(1, ir.sections.reduce((s, sec) => s + sec.blocks.length, 0));
  let doneBlocks = 0;
  let prevGeom = null;

  for (const section of ir.sections) {
    const pg = section.page;
    let geom = { w: pg.w, h: pg.h, top: pg.top, bottom: pg.bottom, left: pg.left, right: pg.right };
    if (geom.w - geom.left - geom.right < 72 || geom.h - geom.top - geom.bottom < 72) {
      warnings.add('A page had unusable margins; default margins were used instead.');
      geom = { ...geom, top: 72, bottom: 72, left: 72, right: 72 };
    }
    geom.contentW = geom.w - geom.left - geom.right;
    geom.contentH = geom.h - geom.top - geom.bottom;

    const same = prevGeom && prevGeom.w === geom.w && prevGeom.h === geom.h && prevGeom.left === geom.left && prevGeom.top === geom.top;
    if (!(section.type === 'continuous' && same && state.page)) {
      state.page = null;
      state.suppress = false;
    }
    prevGeom = geom;

    // Lay out + place in chunks so the browser stays responsive on big documents.
    const CHUNK = 25;
    for (let i = 0; i < section.blocks.length; i += CHUNK) {
      throwIfAborted(signal);
      const chunk = section.blocks.slice(i, i + CHUNK);
      place(layoutBlocks(chunk, geom.contentW, geom), geom);
      doneBlocks += chunk.length;
      onProgress?.({ percent: 30 + (doneBlocks / totalBlocks) * 62, label: 'Laying out', detail: `Page ${doc.getPageCount()}` });
      await yieldToBrowser();
    }
  }

  if (doc.getPageCount() === 0) doc.addPage([595.28, 841.89]);

  if (replacedCount) {
    const sample = [...replacedChars].join(' ');
    warnings.add(`${replacedCount} character${replacedCount === 1 ? '' : 's'} outside the built-in Latin fonts (for example ${sample}) ${replacedCount === 1 ? 'was' : 'were'} replaced with "?". Text in other scripts cannot be rendered by the browser converter.`);
  }

  onProgress?.({ percent: 95, label: 'Saving', detail: 'Writing the PDF' });
  await yieldToBrowser();
  const bytes = await savePdf(doc);
  return { bytes, pageCount: doc.getPageCount(), warnings: [...warnings] };
}

// ── IR walkers ──────────────────────────────────────────────────────────────

function forEachParagraph(sections, fn) {
  const visit = (blocks) => {
    for (const b of blocks) {
      if (b.type === 'p') fn(b);
      else for (const row of b.rows) for (const cell of row.cells) visit(cell.blocks);
    }
  };
  for (const s of sections) visit(s.blocks);
}

function forEachInline(sections, fn) {
  forEachParagraph(sections, (p) => p.inlines.forEach(fn));
}

// ── image embedding ─────────────────────────────────────────────────────────

/** @returns {Promise<import('pdf-lib').PDFImage | null>} */
async function embedImage(doc, image) {
  try {
    if (image.kind === 'png') return await doc.embedPng(image.data);
    if (image.kind === 'jpg') return await doc.embedJpg(image.data);
    if (['gif', 'bmp', 'webp', 'tiff', 'svg'].includes(image.kind)) {
      const mime = { gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tiff: 'image/tiff', svg: 'image/svg+xml' }[image.kind];
      const url = URL.createObjectURL(new Blob([image.data], { type: mime }));
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 300;
        canvas.height = img.naturalHeight || 150;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas, 'image/png');
        releaseCanvas(canvas);
        return await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch {
    /* fall through to placeholder */
  }
  return null;
}
