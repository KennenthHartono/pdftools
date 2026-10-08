/**
 * Shared page layout for every tool, so all eight feel like one machine:
 *
 *   TOOL TITLE + description + badges + (optional) limitation note
 *   01 INPUT  →  02 OPTIONS  →  03 QUEUE  →  04 PROCESS  →  05 RESULT
 *
 * Each tool picks the panels it needs; unused ones are simply not created.
 */

import { h, button, badge } from './components.js';
import { icon } from './icons.js';
import { pad, formatBytes } from '../core/utils.js';
import { downloadBlob, downloadZip } from '../core/downloads.js';
import { humanizeError } from '../core/errors.js';
import { toast, announce } from './notifications.js';

/**
 * @typedef {object} PanelHandle
 * @property {HTMLElement} el
 * @property {HTMLElement} body
 * @property {() => void} show
 * @property {() => void} hide
 */

/**
 * @param {HTMLElement} container
 * @param {{num: string, title: string, description: string, badges: string[], note?: {label: string, text: string}}} meta
 * @param {{id: string, title: string, hint?: string, hidden?: boolean}[]} panelDefs
 * @returns {{ root: HTMLElement, panels: Record<string, PanelHandle> }}
 */
export function createToolLayout(container, meta, panelDefs) {
  const head = h(
    'header',
    { class: 'tool-head' },
    h('p', { class: 'tool-num' }, `TOOL ${meta.num}`),
    h('h1', { class: 'tool-title', id: 'tool-title', tabindex: '-1' }, meta.title),
    h('p', { class: 'tool-desc' }, meta.description),
    h('div', { class: 'tool-badges' }, ...meta.badges.map((f) => badge(f, 'ink')), badge('LOCAL PROCESSING', 'ok')),
    meta.note ? h('aside', { class: 'tool-note' }, h('span', { class: 'tool-note-label' }, meta.note.label), h('p', null, meta.note.text)) : null,
  );

  const root = h('div', { class: 'tool' }, head);
  /** @type {Record<string, PanelHandle>} */
  const panels = {};

  panelDefs.forEach((def, i) => {
    const titleId = `panel-${def.id}-title`;
    const body = h('div', { class: 'panel-body' });
    const el = h(
      'section',
      { class: 'panel', 'aria-labelledby': titleId, dataset: { panel: def.id } },
      h('header', { class: 'panel-head' }, h('span', { class: 'panel-num', 'aria-hidden': 'true' }, pad(i + 1)), h('h2', { class: 'panel-title', id: titleId }, def.title), def.hint ? h('span', { class: 'panel-hint' }, def.hint) : null),
      body,
    );
    el.hidden = Boolean(def.hidden);
    panels[def.id] = {
      el,
      body,
      show: () => {
        el.hidden = false;
      },
      hide: () => {
        el.hidden = true;
      },
    };
    root.append(el);
  });

  container.replaceChildren(root);
  return { root, panels };
}

/** Bar that sits above a loaded single file: name, size, pages, CHANGE FILE. */
export function fileInfoBar({ name, size, detail, onChange }) {
  return h(
    'div',
    { class: 'fileinfo' },
    h('span', { class: 'file-badge' }, 'PDF'),
    h('div', { class: 'fileinfo-main' }, h('span', { class: 'queue-name', title: name }, name), h('span', { class: 'queue-meta' }, [formatBytes(size), detail].filter(Boolean).join('  ·  '))),
    button({ label: 'CHANGE FILE', variant: 'secondary', size: 'sm', onClick: onChange }),
  );
}

/**
 * Success state with download actions.
 *
 * @param {HTMLElement} body  The panel body to fill.
 * @param {object} config
 * @param {{name: string, blob: Blob, label?: string, thumbUrl?: string}[]} config.files
 * @param {string} [config.title]
 * @param {string} [config.message]
 * @param {string} [config.zipName]   Used when there is more than one file.
 * @param {Node[]} [config.extra]     Extra content (stats, warnings) shown above the files.
 * @param {() => void} [config.onAnother]
 * @param {string} [config.anotherLabel]
 * @param {'ok'|'warn'} [config.tone]
 */
export function renderSuccess(body, { files, title = 'PROCESS COMPLETE', message = 'Your file is ready.', zipName = 'document-lab.zip', extra = [], onAnother, anotherLabel = 'PROCESS ANOTHER', tone = 'ok' }) {
  const single = files.length === 1;
  const heading = h('h3', { class: 'result-title', tabindex: '-1' }, h('span', { class: 'result-mark', 'aria-hidden': 'true' }, icon(tone === 'ok' ? 'check' : 'warn', { size: 20 })), title);

  const list = h(
    'ul',
    { class: 'result-files' },
    files.map((f) =>
      h(
        'li',
        { class: 'result-file' },
        f.thumbUrl ? h('img', { class: 'result-thumb', src: f.thumbUrl, alt: '', loading: 'lazy' }) : h('span', { class: 'file-badge' }, (f.name.split('.').pop() ?? 'FILE').toUpperCase().slice(0, 5)),
        h('div', { class: 'result-file-main' }, h('span', { class: 'queue-name', title: f.name }, f.name), h('span', { class: 'queue-meta' }, [formatBytes(f.blob.size), f.label].filter(Boolean).join('  ·  '))),
        button({ label: 'DOWNLOAD', variant: single ? 'primary' : 'secondary', size: 'sm', icon: 'download', ariaLabel: `Download ${f.name}`, onClick: () => downloadBlob(f.blob, f.name) }),
      ),
    ),
  );

  const actions = h('div', { class: 'result-actions' });
  if (!single) {
    const zipBtn = button({
      label: `DOWNLOAD ALL (ZIP)`,
      variant: 'primary',
      icon: 'download',
      onClick: async () => {
        zipBtn.disabled = true;
        try {
          await downloadZip(files.map((f) => ({ name: f.name, blob: f.blob })), zipName);
        } catch (err) {
          toast(humanizeError(err).message, { tone: 'error' });
        } finally {
          zipBtn.disabled = false;
        }
      },
    });
    actions.append(zipBtn);
  } else {
    actions.append(button({ label: 'DOWNLOAD RESULT', variant: 'primary', icon: 'download', onClick: () => downloadBlob(files[0].blob, files[0].name) }));
  }
  if (onAnother) actions.append(button({ label: anotherLabel, variant: 'secondary', icon: 'retry', onClick: onAnother }));

  const wrap = h('div', { class: `result result--${tone}` }, heading, h('p', { class: 'result-message' }, message), ...extra, list, actions);
  body.replaceChildren(wrap);
  body.closest('.panel')?.removeAttribute('hidden');
  wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  heading.focus({ preventScroll: true });
  announce(`${title}. ${message}`);
  return wrap;
}

/**
 * Failure state: readable message plus TRY AGAIN / CHOOSE ANOTHER FILE.
 * @param {HTMLElement} body
 * @param {unknown} error
 * @param {{kind?: 'pdf'|'image'|'docx'|'file', onRetry?: () => void, onChooseAnother?: () => void, chooseLabel?: string}} [options]
 */
export function renderFailure(body, error, { kind = 'file', onRetry, onChooseAnother, chooseLabel = 'CHOOSE ANOTHER FILE' } = {}) {
  const { title, message } = humanizeError(error, kind);
  const heading = h('h3', { class: 'result-title', tabindex: '-1' }, h('span', { class: 'result-mark', 'aria-hidden': 'true' }, icon('warn', { size: 20 })), title);
  const actions = h('div', { class: 'result-actions' }, onRetry ? button({ label: 'TRY AGAIN', variant: 'primary', icon: 'retry', onClick: onRetry }) : null, onChooseAnother ? button({ label: chooseLabel, variant: 'secondary', onClick: onChooseAnother }) : null);
  const wrap = h('div', { class: 'result result--error', role: 'alert' }, heading, h('p', { class: 'result-message' }, message), actions);
  body.replaceChildren(wrap);
  body.closest('.panel')?.removeAttribute('hidden');
  wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  heading.focus({ preventScroll: true });
  return wrap;
}

/** Small stats table, e.g. Original / Result / Saved. */
export function statsTable(rows) {
  return h('dl', { class: 'stats' }, rows.map(([label, value, tone]) => h('div', { class: `stats-row${tone ? ` stats-row--${tone}` : ''}` }, h('dt', null, label), h('dd', null, value))));
}

/** Collapsible list of warnings (limitations hit while processing). */
export function warningsBlock(warnings, heading = 'NOTES ON THIS RESULT') {
  if (!warnings?.length) return null;
  return h('details', { class: 'warnings', open: true }, h('summary', null, `${heading} (${warnings.length})`), h('ul', null, warnings.map((w) => h('li', null, w))));
}
