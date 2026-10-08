/** Tool UI: Compress PDF */

import { createToolLayout, fileInfoBar, renderSuccess, renderFailure, statsTable } from '../ui/toolShell.js';
import { createDropZone } from '../ui/uploader.js';
import { radioGroup } from '../ui/controls.js';
import { button, createProgressPanel, h } from '../ui/components.js';
import { toast } from '../ui/notifications.js';
import { compressPdf, COMPRESSION_MODES } from '../pdf/compressPdf.js';
import { loadPdfDocument } from '../pdf/pdfDocument.js';
import { baseName, formatBytes, plural } from '../core/utils.js';
import { humanizeError } from '../core/errors.js';
import { PDF_KIND, actionBar, toBlob, createAbort, setBusy } from './common.js';

export async function mount(container, { scope, meta }) {
  const L = createToolLayout(container, meta, [
    { id: 'input', title: 'INPUT' },
    { id: 'options', title: 'COMPRESSION', hidden: true },
    { id: 'action', title: 'COMPRESS', hidden: true },
    { id: 'result', title: 'RESULT', hidden: true },
  ]);
  const abort = createAbort(scope);
  let file = null;
  let running = false;

  const drop = createDropZone({ kind: PDF_KIND, title: 'DROP PDF HERE', onFiles: ([f]) => load(f) });
  L.panels.input.body.append(drop.el);

  const mode = radioGroup({
    legend: 'MODE',
    value: 'basic',
    options: Object.entries(COMPRESSION_MODES).map(([value, m]) => ({ value, label: m.label, hint: m.lossy ? 'lossy' : 'no re-encoding' })),
    onChange: sync,
  });
  const description = h('p', { class: 'mode-text', role: 'status' });
  const warning = h('p', { class: 'mode-warning' });
  L.panels.options.body.append(
    mode.el,
    description,
    warning,
    h('p', { class: 'note-line' }, 'How much a PDF shrinks depends heavily on what is inside it. Scans and photo-heavy files can shrink a lot; text-only PDFs usually barely change, and the lossy modes can even make them bigger.'),
  );

  function sync() {
    const m = COMPRESSION_MODES[mode.value];
    description.textContent = m.summary;
    warning.textContent = m.lossy ? 'Warning: image quality is reduced and text is turned into a picture (it can no longer be selected or searched). Keep your original file.' : '';
    warning.hidden = !m.lossy;
  }

  const progress = createProgressPanel({ cancellable: false });
  const runBtn = button({ label: 'COMPRESS PDF', variant: 'primary', size: 'lg', icon: 'compress', onClick: run });
  L.panels.action.body.append(actionBar(runBtn), progress.el);

  async function load(f) {
    reset();
    file = f;
    let pages = '';
    try {
      pages = plural((await loadPdfDocument(f)).getPageCount(), 'page');
    } catch (err) {
      file = null;
      renderFailure(L.panels.result.body, err, { kind: 'pdf', onChooseAnother: reset });
      L.panels.result.show();
      return;
    }
    drop.el.replaceWith(fileInfoBar({ name: f.name, size: f.size, detail: pages, onChange: reset }));
    L.panels.options.show();
    L.panels.action.show();
    sync();
  }

  function reset() {
    file = null;
    L.panels.input.body.replaceChildren(drop.el);
    for (const id of ['options', 'action', 'result']) L.panels[id].hide();
    L.panels.result.body.replaceChildren();
    progress.hide();
  }

  async function run() {
    if (running || !file) return;
    running = true;
    setBusy(true, runBtn, mode);
    L.panels.result.hide();
    progress.show('COMPRESSING');
    try {
      const r = await compressPdf(file, { mode: mode.value, onProgress: progress.update, signal: abort.signal });
      progress.hide();
      const stats = statsTable([
        ['Original', formatBytes(r.originalSize)],
        ['Result', formatBytes(r.resultSize)],
        [r.larger ? 'Change' : 'Saved', r.larger ? `+${Math.abs(r.savedPercent)}% (larger)` : `${r.savedPercent}%`, r.larger ? 'bad' : 'good'],
      ]);
      const extra = [stats];
      if (r.larger) {
        extra.push(h('p', { class: 'mode-warning' }, 'Compression was ineffective: the result is not smaller than the original. This PDF is probably already optimised or contains mostly text and vector graphics. Keep your original file.'));
      } else if (COMPRESSION_MODES[r.mode].lossy) {
        extra.push(h('p', { class: 'note-line' }, 'Pages were re-encoded as JPEG images. Check the result before discarding the original.'));
      }
      renderSuccess(L.panels.result.body, {
        title: r.larger ? 'PROCESS COMPLETE — NO SAVING' : 'PROCESS COMPLETE',
        tone: r.larger ? 'warn' : 'ok',
        message: r.larger ? 'The compressed file is not smaller.' : 'Your file is ready.',
        files: [{ name: `${baseName(file.name)}_compressed.pdf`, blob: toBlob(r.bytes, 'application/pdf') }],
        extra,
        onAnother: reset,
        anotherLabel: 'PROCESS ANOTHER PDF',
      });
      L.panels.result.show();
    } catch (err) {
      progress.hide();
      if (humanizeError(err).code === 'ABORTED') toast('Cancelled.');
      else {
        renderFailure(L.panels.result.body, err, { kind: 'pdf', onRetry: run, onChooseAnother: reset });
        L.panels.result.show();
      }
    } finally {
      running = false;
      setBusy(false, runBtn, mode);
    }
  }
}
