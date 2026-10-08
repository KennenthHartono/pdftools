/** Tool UI: Rotate PDF */

import { createToolLayout, fileInfoBar, renderSuccess, renderFailure } from '../ui/toolShell.js';
import { createDropZone } from '../ui/uploader.js';
import { createPageGrid } from '../ui/thumbnails.js';
import { radioGroup } from '../ui/controls.js';
import { button, createProgressPanel, h } from '../ui/components.js';
import { toast } from '../ui/notifications.js';
import { openPdf } from '../pdf/pdfRender.js';
import { rotatePdf } from '../pdf/rotatePdf.js';
import { baseName, plural } from '../core/utils.js';
import { humanizeError } from '../core/errors.js';
import { PDF_KIND, actionBar, toBlob, setBusy } from './common.js';

export async function mount(container, { scope, meta }) {
  const L = createToolLayout(container, meta, [
    { id: 'input', title: 'INPUT' },
    { id: 'options', title: 'ROTATION', hidden: true },
    { id: 'pages', title: 'PAGES', hint: 'Thumbnails show the result before you save', hidden: true },
    { id: 'action', title: 'ROTATE', hidden: true },
    { id: 'result', title: 'RESULT', hidden: true },
  ]);
  let pdf = null;
  let grid = null;
  let file = null;
  let running = false;

  const drop = createDropZone({ kind: PDF_KIND, title: 'DROP PDF HERE', onFiles: ([f]) => load(f) });
  L.panels.input.body.append(drop.el);

  const angle = radioGroup({
    legend: 'ROTATE',
    value: '90',
    options: [{ value: '90', label: '90° CLOCKWISE' }, { value: '180', label: '180°' }, { value: '270', label: '270° CLOCKWISE' }],
    onChange: sync,
  });
  const target = radioGroup({ legend: 'APPLY TO', value: 'all', options: [{ value: 'all', label: 'ALL PAGES' }, { value: 'selected', label: 'SELECTED PAGES' }], onChange: sync });
  const countEl = h('p', { class: 'grid-count', role: 'status' });
  L.panels.options.body.append(h('div', { class: 'form-grid' }, angle.el, target.el));

  const gridHost = h('div', { class: 'grid-host' });
  L.panels.pages.body.append(
    h('div', { class: 'grid-tools' }, button({ label: 'SELECT ALL', size: 'sm', onClick: () => pick(() => grid.selectAll()) }), button({ label: 'CLEAR', size: 'sm', onClick: () => pick(() => grid.clear()) }), button({ label: 'INVERT', size: 'sm', onClick: () => pick(() => grid.invert()) }), countEl),
    gridHost,
  );
  const pick = (fn) => {
    target.value = 'selected';
    fn();
    sync();
  };

  const progress = createProgressPanel();
  const rotateBtn = button({ label: 'ROTATE PDF', variant: 'primary', size: 'lg', icon: 'rotate', onClick: run });
  L.panels.action.body.append(actionBar(rotateBtn), progress.el);

  function sync() {
    if (!grid) return;
    const deg = Number(angle.value);
    grid.setRotationPreview((n) => (target.value === 'all' || grid.selected.has(n) ? deg : 0));
    countEl.textContent = target.value === 'all' ? `ALL ${grid.pageCount} PAGES` : `${grid.selected.size} OF ${grid.pageCount} SELECTED`;
    grid.setDimmed(target.value === 'all');
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
    grid = createPageGrid({
      doc: pdf.doc,
      onChange: () => {
        if (target.value === 'all') target.value = 'selected';
        sync();
      },
    });
    gridHost.replaceChildren(grid.el);
    for (const id of ['options', 'pages', 'action']) L.panels[id].show();
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
    if (running || !pdf) return;
    const pages = target.value === 'all' ? null : grid.getSelected();
    if (pages && !pages.length) {
      toast('Select at least one page first.', { tone: 'warn' });
      return;
    }
    running = true;
    setBusy(true, rotateBtn, angle, target);
    L.panels.result.hide();
    progress.show('ROTATING');
    try {
      const { bytes, rotated } = await rotatePdf(file, { angle: Number(angle.value), pages, onProgress: progress.update });
      progress.hide();
      renderSuccess(L.panels.result.body, {
        files: [{ name: `${baseName(file.name)}_rotated.pdf`, blob: toBlob(bytes, 'application/pdf'), label: `${plural(rotated, 'page')} rotated ${angle.value}°` }],
        message: 'Your file is ready.',
        onAnother: reset,
        anotherLabel: 'PROCESS ANOTHER PDF',
      });
      L.panels.result.show();
    } catch (err) {
      progress.hide();
      if (humanizeError(err).code === 'ABORTED') toast('Rotation cancelled.');
      else {
        renderFailure(L.panels.result.body, err, { kind: 'pdf', onRetry: run, onChooseAnother: reset });
        L.panels.result.show();
      }
    } finally {
      running = false;
      setBusy(false, rotateBtn, angle, target);
    }
  }
}
