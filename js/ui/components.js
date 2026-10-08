/**
 * Reusable UI building blocks: element helper, buttons, badges, progress
 * panel, empty state. Everything is built with DOM APIs and textContent,
 * never with innerHTML, so file names and document text cannot inject markup.
 */

import { icon } from './icons.js';
import { announce } from './notifications.js';
import { clampPercent } from '../core/progress.js';

/**
 * Tiny hyperscript helper.
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]  `class`, `dataset`, `on*` handlers, any attribute.
 * @param {...(Node|string|number|null|undefined|false|Array<any>)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * Mechanical push-button.
 * @param {object} options
 * @param {string} options.label
 * @param {'primary'|'secondary'|'ghost'|'danger'} [options.variant]
 * @param {string} [options.icon]
 * @param {(event: MouseEvent) => void} [options.onClick]
 * @param {boolean} [options.disabled]
 * @param {string} [options.ariaLabel]
 * @param {'sm'|'md'|'lg'} [options.size]
 * @returns {HTMLButtonElement}
 */
export function button({ label, variant = 'secondary', icon: iconName, onClick, disabled = false, ariaLabel, size = 'md', type = 'button', className = '' }) {
  const el = /** @type {HTMLButtonElement} */ (
    h(
      'button',
      { type, class: `btn btn--${variant} btn--${size} ${className}`.trim(), 'aria-label': ariaLabel, disabled },
      iconName ? icon(iconName, { size: size === 'sm' ? 16 : 18 }) : null,
      label ? h('span', { class: 'btn-label' }, label) : null,
    )
  );
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

/** Icon-only button with a required accessible name. */
export function iconButton({ icon: iconName, label, onClick, disabled = false, className = '' }) {
  const el = /** @type {HTMLButtonElement} */ (
    h('button', { type: 'button', class: `icon-btn ${className}`.trim(), 'aria-label': label, title: label, disabled }, icon(iconName, { size: 18 }))
  );
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

/** Small mono label, e.g. a file type. */
export function badge(text, tone = 'neutral') {
  return h('span', { class: `badge badge--${tone}` }, text);
}

/** Status dot + text, e.g. "● READY". */
export function statusDot(text, tone = 'ok') {
  return h('span', { class: `status status--${tone}` }, h('span', { class: 'status-dot', 'aria-hidden': 'true' }), text);
}

/**
 * Empty state shown inside a queue before any file is loaded.
 */
export function emptyState({ title, body, actionLabel, onAction }) {
  return h(
    'div',
    { class: 'empty' },
    h('p', { class: 'empty-title' }, title),
    h('p', { class: 'empty-body' }, body),
    actionLabel ? button({ label: actionLabel, variant: 'secondary', onClick: onAction }) : null,
  );
}

/**
 * Progress panel: segmented bar, percentage, current item.
 * @param {{ cancellable?: boolean, onCancel?: () => void }} [options]
 */
export function createProgressPanel({ cancellable = false, onCancel } = {}) {
  const title = h('span', { class: 'progress-title' }, 'PROCESSING');
  const pct = h('span', { class: 'progress-pct' }, '0%');
  const fill = h('span', { class: 'progress-fill' });
  const bar = h('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Progress' }, fill);
  const label = h('span', { class: 'progress-label' });
  const detail = h('span', { class: 'progress-detail' });
  const cancelBtn = cancellable ? button({ label: 'CANCEL', variant: 'ghost', size: 'sm', onClick: () => onCancel?.() }) : null;
  const el = h(
    'div',
    { class: 'progress', hidden: true },
    h('div', { class: 'progress-head' }, title, pct),
    bar,
    h('p', { class: 'progress-line' }, label, ' ', detail),
    cancelBtn,
  );

  let lastAnnounced = -1;
  return {
    el,
    show(heading = 'PROCESSING') {
      title.textContent = heading;
      el.hidden = false;
      lastAnnounced = -1;
      this.update({ percent: 0 });
      announce(`${heading}`);
    },
    /** @param {import('../core/progress.js').ProgressInfo} info */
    update({ percent, label: l, detail: d }) {
      const p = Math.round(clampPercent(percent));
      fill.style.width = `${p}%`;
      pct.textContent = `${p}%`;
      bar.setAttribute('aria-valuenow', String(p));
      if (l !== undefined) label.textContent = l ? `${l}:` : '';
      if (d !== undefined) detail.textContent = d;
      const bucket = Math.floor(p / 25);
      if (bucket !== lastAnnounced && p > 0 && p < 100) {
        lastAnnounced = bucket;
        announce(`${p} percent`);
      }
    },
    hide() {
      el.hidden = true;
    },
    setCancelDisabled(disabled) {
      if (cancelBtn) cancelBtn.disabled = disabled;
    },
  };
}
