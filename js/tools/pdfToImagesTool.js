/** Tool UI: PDF → JPG / PNG */

import { createToolLayout, fileInfoBar, renderSuccess, renderFailure } from '../ui/toolShell.js';
import { createDropZone } from '../ui/uploader.js';
import { createPageGrid } from '../ui/thumbnails.js';
import { radioGroup, rangeField, selectField } from '../ui/controls.js';
import { button, createProgressPanel, h } from '../ui/components.js';
import { toast } from '../ui/notifications.js';
import { openPdf } from '../pdf/pdfRender.js';
import { convertPagesToImages } from '../pdf/pdfToImages.js';
import { baseName, plural } from '../core/utils.js';
import { humanizeError } from '../core/errors.js';
import { PDF_KIND, actionBar, createAbort, setBusy } from './common.js';

export async function mount(container, { scope, meta }) {
  const L = createToolLayout(container, meta, [
    { id: 'input', title: 'INPUT' },
    { id: 'options', title: 'OUTPUT SETTINGS', hidden: true },
    { id: 'pages', title: 'PAGES', hint: 'Click to select · Shift+click for a range', hidden: true },
    { id: 'action', title: 'CONVERT', hidden: true },
    { id: 'result', title: 'RESULT', hidden: true },
  ]);
  const abort = createAbort(scope);
  let pdf = null;
  let grid = null;
  let file = null;
  let running = false;

  const drop = createDropZone({ kind: PDF_KIND, title: 'DROP PDF HERE', onFiles: ([f]) => load(f) });
  L.panels.input.body.append(drop.el);

  // options
  const format = radioGroup({ legend: 'OUTPUT', value: 'jpg', options: [{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }], onChange: syncOptions });
  const quality = rangeField({ label: 'JPG QUALITY', min: 40, max: 100, step: 5, value: 90, format: (v) => `${v}%` });
  const dpi = selectField({
    label: 'RESOLUTION',
    value: '150',
    options: [
      { value: '72', label: '72 dpi — screen size' },
      { value: '110', label: '110 dpi — small' },
      { value: '150', label: '150 dpi — standard' },
      { value: '200', label: '200 dpi — sharp' },
      { value: '300', label: '300 dpi — print' },
    ],
  });
  const scopeChoice = radioGroup({
    legend: 'PAGES',
    value: 'all',
    options: [{ value: 'all', label: 'ALL PAGES' }, { value: 'selected', label: 'SELECTED PAGES' }],
    onChange: syncOptions,
  });
  L.panels.options.body.append(h('div', { class: 'form-grid' }, format.el, quality.el, dpi.el, scopeChoice.el));

  function syncOptions() {
    quality.setHidden(format.value !== 'jpg');
    grid?.setDimmed(scopeChoice.value === 'all');
    updateCount();
  }

  const countEl = h('p', { class: 'grid-count', role: 'status' });
  const gridHost = h('div', { class: 'grid-host' });
  const gridTools = h(
    'div',
    { class: 'grid-tools' },
    button({ label: 'SELECT ALL', size: 'sm', onClick: () => selectPages(() => grid.selectAll()) }),
    button({ label: 'CLEAR', size: 'sm', onClick: () => selectPages(() => grid.clear()) }),
    button({ label: 'INVERT', size: 'sm', onClick: () => selectPages(() => grid.invert()) }),
    countEl,
  );
  L.panels.pages.body.append(gridTools, gridHost);

  function selectPages(fn) {
    scopeChoice.value = 'selected';
    fn();
    syncOptions();
  }
  function updateCount() {
    if (!grid) return;
    countEl.textContent = scopeChoice.value === 'all' ? `ALL ${grid.pageCount} PAGES WILL BE CONVERTED` : `${grid.selected.size} OF ${grid.pageCount} SELECTED`;
  }

  const progress = createProgressPanel({ cancellable: true, onCancel: () => cancelCurrent?.abort() });
  let cancelCurrent = null;
  const convertBtn = button({ label: 'CONVERT', variant: 'primary', size: 'lg', icon: 'arrow', onClick: convert });
  L.panels.action.body.append(actionBar(convertBtn), progress.el);

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
    grid = createPageGrid({ doc: pdf.doc, onChange: () => { if (scopeChoice.value === 'all') scopeChoice.value = 'selected'; syncOptions(); } });
    gridHost.replaceChildren(grid.el);
    for (const id of ['options', 'pages', 'action']) L.panels[id].show();
    syncOptions();
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

  async function convert() {
    if (running || !pdf) return;
    const pages = scopeChoice.value === 'all' ? Array.from({ length: pdf.pageCount }, (_, i) => i + 1) : grid.getSelected();
    if (!pages.length) {
      toast('Select at least one page first.', { tone: 'warn' });
      return;
    }
    running = true;
    cancelCurrent = new AbortController();
    abort.signal.addEventListener('abort', () => cancelCurrent.abort(), { once: true });
    setBusy(true, convertBtn, format, quality, dpi, scopeChoice);
    L.panels.result.hide();
    progress.show('CONVERTING');
    try {
      const { images, clamped } = await convertPagesToImages({
        doc: pdf.doc,
        pages,
        format: format.value,
        quality: quality.value / 100,
        dpi: Number(dpi.value),
        baseName: baseName(file.name),
        onProgress: progress.update,
        signal: cancelCurrent.signal,
      });
      progress.hide();
      const extra = clamped ? [h('p', { class: 'note-line' }, `${plural(clamped, 'page')} ${clamped === 1 ? 'was' : 'were'} rendered at a lower resolution than requested to stay within your browser's canvas size limit.`)] : [];
      renderSuccess(L.panels.result.body, {
        files: images.map((img) => ({ name: img.name, blob: img.blob, label: `${img.width} × ${img.height} px`, thumbUrl: scope.url(img.blob) })),
        message: `${plural(images.length, 'image')} created.`,
        zipName: `${baseName(file.name)}_images.zip`,
        extra,
        onAnother: reset,
        anotherLabel: 'PROCESS ANOTHER PDF',
      });
      L.panels.result.show();
    } catch (err) {
      progress.hide();
      if (humanizeError(err).code === 'ABORTED') toast('Conversion cancelled.');
      else {
        renderFailure(L.panels.result.body, err, { kind: 'pdf', onRetry: convert, onChooseAnother: reset });
        L.panels.result.show();
      }
    } finally {
      running = false;
      setBusy(false, convertBtn, format, quality, dpi, scopeChoice);
    }
  }
}
