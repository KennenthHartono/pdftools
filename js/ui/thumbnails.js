/**
 * Page thumbnail grid for PDF tools.
 *
 * - Pages render lazily: only cards near the viewport are drawn, one at a
 *   time, at a small size. Cards that scroll far away release their canvas,
 *   so even a 1,000-page PDF stays within a modest memory budget.
 * - Cards are real <button aria-pressed> elements: keyboard and screen-reader
 *   friendly. Shift+click selects a range.
 */

import { h } from './components.js';
import { CONFIG } from '../config.js';
import { pad } from '../core/utils.js';
import { renderPageToCanvas } from '../pdf/pdfRender.js';
import { releaseCanvas } from '../core/memory.js';

/**
 * @param {object} config
 * @param {any} config.doc          PDF.js document
 * @param {(selected: Set<number>) => void} [config.onChange]
 * @param {number} [config.size]
 */
export function createPageGrid({ doc, onChange, size = CONFIG.thumbnailSize }) {
  const pageCount = doc.numPages;
  const selected = new Set();
  let rotationOf = () => 0;
  let lastClicked = null;
  let destroyed = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  /** @type {{n: number, button: HTMLButtonElement, canvas: HTMLCanvasElement, state: string, abort: AbortController | null}[]} */
  const cards = [];
  const pending = [];
  let pumping = false;

  const el = h('div', { class: 'page-grid', role: 'group', 'aria-label': `Pages (${pageCount})`, style: `--thumb:${size}px` });

  for (let n = 1; n <= pageCount; n++) {
    const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { 'aria-hidden': 'true' }));
    const btn = /** @type {HTMLButtonElement} */ (
      h(
        'button',
        { type: 'button', class: 'page-card', 'aria-pressed': 'false', 'aria-label': `Page ${n}`, dataset: { page: String(n) } },
        h('span', { class: 'page-frame' }, canvas),
        h('span', { class: 'page-label' }, `PAGE ${pad(n, String(pageCount).length < 2 ? 2 : String(pageCount).length)}`),
      )
    );
    btn.addEventListener('click', (e) => onCardClick(n, e.shiftKey));
    cards.push({ n, button: btn, canvas, state: 'idle', abort: null });
    el.append(btn);
  }

  function onCardClick(n, shift) {
    if (shift && lastClicked) {
      const [a, b] = [Math.min(lastClicked, n), Math.max(lastClicked, n)];
      const turnOn = !selected.has(n);
      for (let i = a; i <= b; i++) setPage(i, turnOn);
    } else {
      setPage(n, !selected.has(n));
    }
    lastClicked = n;
    changed();
  }

  function setPage(n, on) {
    if (on) selected.add(n);
    else selected.delete(n);
    const card = cards[n - 1];
    card.button.setAttribute('aria-pressed', String(on));
    card.button.classList.toggle('is-selected', on);
  }

  function changed() {
    onChange?.(selected);
  }

  // ----- lazy rendering -----
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const card = cards[Number(entry.target.dataset.page) - 1];
        if (entry.isIntersecting) enqueue(card);
        else evict(card);
      }
    },
    { rootMargin: '500px 0px' },
  );
  for (const card of cards) observer.observe(card.button);

  function enqueue(card) {
    if (card.state !== 'idle') return;
    card.state = 'queued';
    pending.push(card);
    pump();
  }

  function evict(card) {
    if (card.state === 'queued') {
      card.state = 'idle';
      pending.splice(pending.indexOf(card), 1);
    } else if (card.state === 'rendering') {
      card.abort?.abort();
      card.state = 'idle';
    } else if (card.state === 'done') {
      releaseCanvas(card.canvas);
      card.button.classList.remove('is-rendered');
      card.state = 'idle';
    }
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    while (pending.length && !destroyed) {
      const card = pending.shift();
      if (card.state !== 'queued') continue;
      card.state = 'rendering';
      card.abort = new AbortController();
      try {
        const { canvas } = await renderPageToCanvas(doc, card.n, { maxDimension: size * dpr, canvas: card.canvas, signal: card.abort.signal });
        if (card.state !== 'rendering' || destroyed) {
          releaseCanvas(card.canvas);
          continue;
        }
        const aspect = canvas.width / canvas.height;
        const w = aspect >= 1 ? size : size * aspect;
        const hh = aspect >= 1 ? size / aspect : size;
        canvas.style.width = `${Math.round(w)}px`;
        canvas.style.height = `${Math.round(hh)}px`;
        card.button.classList.add('is-rendered');
        card.state = 'done';
        applyRotation(card);
      } catch (err) {
        if (card.state === 'rendering' && !destroyed && !/Cancel|Abort/i.test(String(err?.name ?? err))) {
          card.state = 'error';
          card.button.classList.add('has-error');
        }
      }
    }
    pumping = false;
  }

  function applyRotation(card) {
    const deg = rotationOf(card.n) % 360;
    card.canvas.style.transform = deg ? `rotate(${deg}deg)` : '';
    card.button.classList.toggle('is-rotated', deg !== 0);
  }

  return {
    el,
    pageCount,
    selected,
    /** Sorted 1-based page numbers. */
    getSelected: () => [...selected].sort((a, b) => a - b),
    selectAll() {
      for (let n = 1; n <= pageCount; n++) setPage(n, true);
      changed();
    },
    clear() {
      for (let n = 1; n <= pageCount; n++) setPage(n, false);
      changed();
    },
    invert() {
      for (let n = 1; n <= pageCount; n++) setPage(n, !selected.has(n));
      changed();
    },
    setSelected(pages) {
      for (let n = 1; n <= pageCount; n++) setPage(n, false);
      for (const n of pages) if (n >= 1 && n <= pageCount) setPage(n, true);
      changed();
    },
    /** Preview rotation (degrees clockwise) per page; does not change the PDF. */
    setRotationPreview(fn) {
      rotationOf = fn;
      for (const card of cards) if (card.state === 'done') applyRotation(card);
    },
    setDimmed(value) {
      el.classList.toggle('is-dimmed', value);
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      for (const card of cards) {
        card.abort?.abort();
        releaseCanvas(card.canvas);
      }
      pending.length = 0;
    },
  };
}
