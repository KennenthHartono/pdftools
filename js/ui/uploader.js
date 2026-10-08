/**
 * Reusable drag-and-drop zone with a real file picker.
 * Drag & drop is never the only way in: the SELECT button is a normal,
 * keyboard-focusable <button> that opens the native picker.
 */

import { h, button } from './components.js';
import { icon } from './icons.js';
import { toast } from './notifications.js';
import { confirmDialog } from './modal.js';
import { extOf, formatBytes } from '../core/utils.js';
import { isLargeFile } from '../core/memory.js';

/**
 * @typedef {object} FileKind
 * @property {string[]} extensions  Accepted extensions without dot, lower-case.
 * @property {string[]} [mimeTypes] Extra accepted MIME types (used when the extension is missing).
 * @property {string} label         Human label used in messages, e.g. "PDF" or "image".
 */

/**
 * @param {object} config
 * @param {FileKind} config.kind
 * @param {boolean} [config.multiple]
 * @param {string} [config.title]
 * @param {string} [config.hint]
 * @param {string} [config.buttonLabel]
 * @param {(files: File[]) => void | Promise<void>} config.onFiles
 */
export function createDropZone({ kind, multiple = false, title = 'DROP FILES HERE', hint, buttonLabel, onFiles }) {
  const accept = [...kind.extensions.map((e) => `.${e}`), ...(kind.mimeTypes ?? [])].join(',');
  const input = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept, multiple, hidden: true, tabindex: '-1', 'aria-hidden': 'true' }));
  const noun = multiple ? `${kind.label} files` : `${kind.label} file`;

  const selectBtn = button({
    label: buttonLabel ?? (multiple ? 'SELECT FILES' : 'SELECT FILE'),
    variant: 'primary',
    icon: 'upload',
    ariaLabel: `Select ${noun} from your device`,
    onClick: () => input.click(),
  });

  const el = h(
    'div',
    { class: 'dropzone', role: 'group', 'aria-label': `Upload ${noun}` },
    h(
      'div',
      { class: 'dropzone-body' },
      h('span', { class: 'dropzone-icon' }, icon('upload', { size: 28 })),
      h('p', { class: 'dropzone-title' }, title),
      h('p', { class: 'dropzone-sub' }, 'or select them from your device'),
      selectBtn,
      h('p', { class: 'dropzone-hint' }, hint ?? `${kind.extensions.map((e) => e.toUpperCase()).join(' · ')}  ·  processed locally`),
    ),
    input,
  );

  const isValid = (file) => {
    const ext = extOf(file.name);
    return ext ? kind.extensions.includes(ext) : (kind.mimeTypes ?? []).includes(file.type);
  };

  /** @param {FileList | File[]} fileList */
  async function handleFiles(fileList) {
    let files = [...fileList];
    if (!files.length) return;

    const rejected = files.filter((f) => !isValid(f));
    files = files.filter(isValid);
    const empty = files.filter((f) => f.size === 0);
    files = files.filter((f) => f.size > 0);

    if (rejected.length) {
      toast(`Skipped ${rejected.length === 1 ? `"${rejected[0].name}"` : `${rejected.length} files`}: not a supported ${kind.label} file.`, { tone: 'error' });
    }
    if (empty.length) {
      toast(`Skipped ${empty.length === 1 ? `"${empty[0].name}"` : `${empty.length} files`}: the file is empty.`, { tone: 'error' });
    }
    if (!multiple && files.length > 1) {
      toast(`This tool takes one file at a time. Using "${files[0].name}".`, { tone: 'warn' });
      files = files.slice(0, 1);
    }

    const large = files.filter(isLargeFile);
    if (large.length) {
      const names = large.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ');
      const proceed = await confirmDialog({
        title: 'LARGE FILE',
        body: `${names}. This document may require significant browser memory and could slow down or crash the tab. Continue?`,
        confirmLabel: 'CONTINUE',
      });
      if (!proceed) files = files.filter((f) => !isLargeFile(f));
    }

    if (files.length) await onFiles(files);
  }

  input.addEventListener('change', async () => {
    await handleFiles(input.files ?? []);
    input.value = ''; // allow choosing the same file again
  });

  // Only react to drags that carry real files (not our own queue-row reordering).
  const carriesFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  let depth = 0;
  el.addEventListener('dragenter', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth++;
    el.classList.add('is-dragover');
  });
  el.addEventListener('dragover', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', (e) => {
    if (!carriesFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('is-dragover');
  });
  el.addEventListener('drop', async (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth = 0;
    el.classList.remove('is-dragover');
    await handleFiles(e.dataTransfer.files);
  });

  return {
    el,
    open: () => input.click(),
    setCompact(compact) {
      el.classList.toggle('dropzone--compact', compact);
    },
    setDisabled(disabled) {
      selectBtn.disabled = disabled;
      el.classList.toggle('is-disabled', disabled);
    },
  };
}
