/** Tool UI: PDF Splitter */

import { createToolLayout, fileInfoBar, renderSuccess, renderFailure } from '../ui/toolShell.js';
import { createDropZone } from '../ui/uploader.js';
import { createPageGrid } from '../ui/thumbnails.js';
import { radioGroup, textField, checkboxField } from '../ui/controls.js';
import { button, createProgressPanel, h } from '../ui/components.js';
import { toast } from '../ui/notifications.js';
import { openPdf } from '../pdf/pdfRender.js';
import { parseRanges, splitPdf } from '../pdf/splitPdf.js';
import { baseName, plural } from '../core/utils.js';
import { humanizeError } from '../core/errors.js';
import { PDF_KIND, actionBar, toBlob, createAbort, setBusy } from './common.js';

export async function mount(container, { scope, meta }) {
  const L = createToolLayout(container, meta, [
    { id: 'input', title: 'INPUT' },
    { id: 'options', title: 'SPLIT MODE', hidden: true },
    { id: 'pages', title: 'PAGES', hint: 'Click to select · Shift+click for a range', hidden: true },
    { id: 'action', title: 'SPLIT', hidden: true },
    { id: 'result', title: 'RESULT', hidden: true },
  ]);
  const abort = createAbort(scope);
  let pdf = null;
  let grid = null;
  let file = null;
  let running = false;

  const drop = createDropZone({ kind: PDF_KIND, title: 'DROP PDF HERE', onFiles: ([f]) => load(f) });
  L.panels.input.body.append(drop.el);

  const mode = radioGroup({
    legend: 'MODE',
    value: 'each',
    options: [
      { value: 'each', label: 'EVERY PAGE', hint: 'one PDF per page' },
      { value: 'ranges', label: 'PAGE RANGES', hint: 'e.g. 1-3, 5, 8-10' },
      { value: 'selected', label: 'SELECTED PAGES', hint: 'pick thumbnails' },
    ],
    onChange: sync,
  });
  const rangeInput = textField({ label: 'RANGES', placeholder: '1-3, 5, 8-10', hint: 'Separate ranges with commas. "7-" means page 7 to the end.', onInput: sync });
  const combine = checkboxField({ label: 'Put all ranges into ONE PDF', hint: 'Otherwise each range becomes its own file.', onChange: sync });
  const summary = h('p', { class: 'summary-line', role: 'status' });
  L.panels.options.body.append(h('div', { class: 'form-grid' }, mode.el, rangeInput.el, combine.el), summary);

  const gridHost = h('div', { class: 'grid-host' });
  const countEl = h('p', { class: 'grid-count', role: 'status' });
  L.panels.pages.body.append(
    h('div', { class: 'grid-tools' }, button({ label: 'SELECT ALL', size: 'sm', onClick: () => grid.selectAll() }), button({ label: 'CLEAR', size: 'sm', onClick: () => grid.clear() }), button({ label: 'INVERT', size: 'sm', onClick: () => grid.invert() }), countEl),
    gridHost,
  );

  const progress = createProgressPanel();
  const splitBtn = button({ label: 'SPLIT PDF', variant: 'primary', size: 'lg', icon: 'split', onClick: run });
  L.panels.action.body.append(actionBar(splitBtn), progress.el);

  /** Work out what the current settings would produce (also used for validation). */
  function plan() {
    if (!pdf) return { ok: false };
    const total = pdf.pageCount;
    if (mode.value === 'each') return { ok: true, files: total, text: `Will create ${plural(total, 'PDF')}, one per page.` };
    if (mode.value === 'selected') {
      const n = grid?.selected.size ?? 0;
      return n ? { ok: true, files: 1, text: `Will create 1 PDF with ${plural(n, 'page')}.` } : { ok: false, text: 'Select at least one page.' };
    }
    const parsed = parseRanges(rangeInput.value, total);
    if (parsed.error) return { ok: false, error: parsed.error, text: rangeInput.value.trim() ? parsed.error : '' };
    const files = combine.value ? 1 : parsed.ranges.length;
    return { ok: true, ranges: parsed.ranges, files, text: `Will create ${plural(files, 'PDF')} from ${plural(parsed.ranges.length, 'range')}.` };
  }

  function sync() {
    if (!pdf) return;
    rangeInput.setHidden(mode.value !== 'ranges');
    combine.setHidden(mode.value !== 'ranges');
    L.panels.pages.el.hidden = mode.value !== 'selected';
    countEl.textContent = `${grid?.selected.size ?? 0} OF ${pdf.pageCount} SELECTED`;
    const p = plan();
    if (mode.value === 'ranges') {
      if (p.error) rangeInput.setMessage(p.error, 'error');
      else if (p.ok) rangeInput.setMessage('Ranges are valid.', 'ok');
      else rangeInput.setMessage('Separate ranges with commas. "7-" means page 7 to the end.', 'hint');
    }
    summary.textContent = p.ok ? p.text : mode.value === 'ranges' ? '' : p.text ?? '';
    splitBtn.disabled = !p.ok || running;
  }

  async function load(f) {
    await reset();
    file = f;
    try {
      pdf = await openPdf(f);
    } catch (err) {
      renderFailure(L.panels.result.body, err, { kind: 'pdf', onChooseAnother: reset });
      L.panels.result.show();
      return;
    }
    drop.el.replaceWith(fileInfoBar({ name: f.name, size: f.size, detail: plural(pdf.pageCount, 'page'), onChange: reset }));
    grid = createPageGrid({ doc: pdf.doc, onChange: sync });
    gridHost.replaceChildren(grid.el);
    L.panels.options.show();
    L.panels.action.show();
    sync();
  }

  async function reset() {
    grid?.destroy();
    grid = null;
    await pdf?.destroy();
    pdf = null;
    L.panels.input.body.replaceChildren(drop.el);
    gridHost.replaceChildren();
    for (const id of ['options', 'pages', 'action', 'result']) L.panels[id].hide();
    L.panels.result.body.replaceChildren();
    progress.hide();
  }
  scope.onDispose(async () => {
    grid?.destroy();
    await pdf?.destroy();
  });

  async function run() {
    const p = plan();
    if (!p.ok || running) return;
    running = true;
    setBusy(true, splitBtn, mode, rangeInput, combine);
    L.panels.result.hide();
    progress.show('SPLITTING');
    try {
      const outputs = await splitPdf(file, {
        mode: mode.value,
        ranges: p.ranges,
        combine: combine.value,
        pages: grid?.getSelected() ?? [],
        baseName: baseName(file.name),
        onProgress: progress.update,
        signal: abort.signal,
      });
      progress.hide();
      renderSuccess(L.panels.result.body, {
        files: outputs.map((o) => ({ name: o.name, blob: toBlob(o.bytes, 'application/pdf'), label: o.label })),
        message: outputs.length > 1 ? `${plural(outputs.length, 'PDF')} created. Download them one by one or all at once as a ZIP.` : 'Your file is ready.',
        zipName: `${baseName(file.name)}_split.zip`,
        onAnother: reset,
        anotherLabel: 'PROCESS ANOTHER PDF',
      });
      L.panels.result.show();
    } catch (err) {
      progress.hide();
      if (humanizeError(err).code === 'ABORTED') toast('Split cancelled.');
      else {
        renderFailure(L.panels.result.body, err, { kind: 'pdf', onRetry: run, onChooseAnother: reset });
        L.panels.result.show();
      }
    } finally {
      running = false;
      setBusy(false, splitBtn, mode, rangeInput, combine);
      sync();
    }
  }
}
