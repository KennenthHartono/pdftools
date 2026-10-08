/** Tool UI: PDF Merger */

import { createToolLayout, renderSuccess, renderFailure } from '../ui/toolShell.js';
import { createDropZone } from '../ui/uploader.js';
import { createQueueView } from '../ui/queueView.js';
import { button, createProgressPanel, h } from '../ui/components.js';
import { toast } from '../ui/notifications.js';
import { FileQueue } from '../core/fileQueue.js';
import { getPdfPageCount, mergePdfs } from '../pdf/mergePdf.js';
import { humanizeError } from '../core/errors.js';
import { plural } from '../core/utils.js';
import { PDF_KIND, actionBar, toBlob, createAbort } from './common.js';

export async function mount(container, { scope, meta }) {
  const L = createToolLayout(container, meta, [
    { id: 'input', title: 'INPUT' },
    { id: 'queue', title: 'MERGE QUEUE', hint: 'Drag rows or use ↑ ↓ to set the order' },
    { id: 'action', title: 'MERGE' },
    { id: 'result', title: 'RESULT', hidden: true },
  ]);
  const abort = createAbort(scope);
  const queue = new FileQueue();
  let running = false;

  const drop = createDropZone({
    kind: PDF_KIND,
    multiple: true,
    title: 'DROP PDFs HERE',
    onFiles: async (files) => {
      drop.setCompact(true);
      L.panels.result.hide();
      const items = queue.add(files);
      for (const item of items) {
        try {
          queue.update(item.id, { meta: { pages: await getPdfPageCount(item.file) } });
        } catch (err) {
          queue.update(item.id, { status: 'error', error: humanizeError(err, 'pdf').message });
        }
      }
    },
  });
  L.panels.input.body.append(drop.el);

  const view = createQueueView({
    queue,
    unit: 'file',
    meta: (item) => (item.meta.pages ? plural(item.meta.pages, 'page') : item.status === 'error' ? '' : 'reading…'),
    empty: { title: 'NO DOCUMENTS LOADED', body: 'Drop files into the workspace or select them from your device.', actionLabel: 'SELECT FILES', onAction: () => drop.open() },
  });
  scope.onDispose(() => view.destroy());
  L.panels.queue.body.append(view.el);

  const addBtn = button({ label: 'ADD MORE', icon: 'plus', onClick: () => drop.open() });
  const mergeBtn = button({ label: 'MERGE PDFs', variant: 'primary', size: 'lg', icon: 'merge', disabled: true, onClick: run });
  const hint = h('p', { class: 'action-hint', 'aria-live': 'polite' });
  const progress = createProgressPanel();
  L.panels.action.body.append(actionBar(addBtn, mergeBtn, hint), progress.el);

  function refresh() {
    const items = queue.items;
    const failed = items.some((i) => i.status === 'error');
    const pending = items.some((i) => i.status === 'idle' && !i.meta.pages);
    mergeBtn.disabled = running || items.length < 2 || failed || pending;
    hint.textContent = failed ? 'Remove the failed file(s) to continue.' : items.length < 2 ? 'Add at least two PDFs.' : `${plural(items.reduce((s, i) => s + (i.meta.pages ?? 0), 0), 'page')} in total.`;
    if (!items.length) drop.setCompact(false);
  }
  scope.onDispose(queue.subscribe(refresh));
  refresh();

  async function run() {
    if (running) return;
    running = true;
    view.setLocked(true);
    refresh();
    L.panels.result.hide();
    progress.show('MERGING');
    try {
      const { bytes, pageCount } = await mergePdfs(queue.items.map((i) => i.file), { onProgress: progress.update, signal: abort.signal });
      progress.hide();
      renderSuccess(L.panels.result.body, {
        files: [{ name: 'merged.pdf', blob: toBlob(bytes, 'application/pdf'), label: plural(pageCount, 'page') }],
        message: `${plural(queue.length, 'document')} merged into one PDF.`,
        onAnother: () => {
          queue.clear();
          L.panels.result.hide();
        },
      });
      L.panels.result.show();
    } catch (err) {
      progress.hide();
      if (err.failedIndex != null) queue.update(queue.items[err.failedIndex].id, { status: 'error', error: err.message });
      if (humanizeError(err).code === 'ABORTED') toast('Merge cancelled.');
      else {
        renderFailure(L.panels.result.body, err, { kind: 'pdf', onRetry: err.failedIndex != null ? undefined : run, onChooseAnother: () => drop.open(), chooseLabel: 'ADD OTHER FILES' });
        L.panels.result.show();
      }
    } finally {
      running = false;
      view.setLocked(false);
      refresh();
    }
  }
}
