/** Tool UI: Word → PDF (one or many documents, each becomes its own PDF) */

import { createToolLayout, renderSuccess, renderFailure, warningsBlock } from '../ui/toolShell.js';
import { createDropZone } from '../ui/uploader.js';
import { createQueueView } from '../ui/queueView.js';
import { button, createProgressPanel, h } from '../ui/components.js';
import { toast } from '../ui/notifications.js';
import { FileQueue } from '../core/fileQueue.js';
import { convertAll } from '../word/wordBatchToPdf.js';
import { humanizeError } from '../core/errors.js';
import { baseName, plural } from '../core/utils.js';
import { DOCX_KIND, actionBar, toBlob, createAbort } from './common.js';

export async function mount(container, { scope, meta }) {
  const L = createToolLayout(container, meta, [
    { id: 'input', title: 'INPUT' },
    { id: 'queue', title: 'DOCUMENT QUEUE' },
    { id: 'action', title: 'CONVERT' },
    { id: 'result', title: 'RESULT', hidden: true },
  ]);
  const abort = createAbort(scope);
  const queue = new FileQueue();
  /** @type {Map<string, import('../word/converter.js').ConversionResult>} */
  const results = new Map();
  let running = false;

  const drop = createDropZone({
    kind: DOCX_KIND,
    multiple: true,
    title: 'DROP .DOCX FILES HERE',
    hint: 'DOCX  ·  processed locally  ·  legacy .doc is not supported',
    onFiles: (files) => {
      drop.setCompact(true);
      L.panels.result.hide();
      queue.add(files);
    },
  });
  L.panels.input.body.append(drop.el);

  const view = createQueueView({
    queue,
    unit: 'document',
    showIdleStatus: true,
    actions: (item) => (item.status === 'error' && !running ? [button({ label: 'RETRY', size: 'sm', icon: 'retry', onClick: () => retryOne(item) })] : []),
    empty: { title: 'NO DOCUMENTS LOADED', body: 'Drop files into the workspace or select them from your device.', actionLabel: 'SELECT FILES', onAction: () => drop.open() },
  });
  scope.onDispose(() => view.destroy());
  L.panels.queue.body.append(view.el);

  const progress = createProgressPanel();
  const runBtn = button({ label: 'CONVERT TO PDF', variant: 'primary', size: 'lg', icon: 'word-to-pdf', disabled: true, onClick: () => run() });
  const hint = h('p', { class: 'action-hint', 'aria-live': 'polite' });
  L.panels.action.body.append(actionBar(button({ label: 'ADD DOCUMENTS', icon: 'plus', onClick: () => drop.open() }), runBtn, hint), progress.el);

  scope.onDispose(
    queue.subscribe((items) => {
      for (const id of [...results.keys()]) if (!items.some((i) => i.id === id)) results.delete(id);
      refresh();
    }),
  );

  function refresh() {
    const failed = queue.items.filter((i) => i.status === 'error').length;
    runBtn.disabled = running || !queue.length;
    runBtn.querySelector('.btn-label').textContent = failed ? 'RETRY FAILED' : 'CONVERT TO PDF';
    hint.textContent = queue.length ? (failed ? `${failed} failed. Retry or remove them.` : `${plural(queue.length, 'document')} ready.`) : 'Add at least one .docx file.';
    if (!queue.length) drop.setCompact(false);
  }
  refresh();

  async function retryOne(item) {
    queue.update(item.id, { status: 'idle', error: null });
    await run();
  }

  async function run() {
    if (running || !queue.length) return;
    running = true;
    view.setLocked(true);
    refresh();
    L.panels.result.hide();
    for (const item of queue.items) if (item.status === 'error') queue.update(item.id, { status: 'idle', error: null });

    const todo = queue.items.filter((i) => !results.has(i.id));
    let finished = queue.length - todo.length;
    progress.show('CONVERTING');
    try {
      await convertAll(todo, results, {
        signal: abort.signal,
        onStart: (item) => {
          queue.update(item.id, { status: 'processing', progress: 0 });
          progress.update({ percent: (finished / queue.length) * 100, label: `${finished} / ${queue.length} documents processed. Current`, detail: item.name });
        },
        onItemProgress: (item, p) => {
          queue.update(item.id, { progress: p });
          progress.update({ percent: ((finished + p / 100) / queue.length) * 100 });
        },
        onDone: (item, outcome) => {
          finished++;
          if (outcome.ok) queue.update(item.id, { status: 'completed', progress: 100, meta: { pages: results.get(item.id).pageCount } });
          else queue.update(item.id, { status: 'error', error: humanizeError(outcome.error, 'docx').message });
        },
      });
      progress.hide();
      showResults();
    } catch (err) {
      progress.hide();
      for (const item of queue.items) if (item.status === 'processing') queue.update(item.id, { status: 'idle' });
      if (humanizeError(err).code === 'ABORTED') toast('Conversion cancelled.');
      else {
        renderFailure(L.panels.result.body, err, { kind: 'docx', onRetry: () => run(), onChooseAnother: () => drop.open(), chooseLabel: 'ADD OTHER DOCUMENTS' });
        L.panels.result.show();
      }
    } finally {
      running = false;
      view.setLocked(false);
      refresh();
    }
  }

  function showResults() {
    const files = [];
    const warnings = new Set();
    for (const item of queue.items) {
      const r = results.get(item.id);
      if (!r) continue;
      files.push({ name: `${baseName(item.name)}.pdf`, blob: toBlob(r.bytes, 'application/pdf'), label: plural(r.pageCount, 'page') });
      for (const w of r.warnings) warnings.add(files.length > 1 || queue.length > 1 ? `${item.name}: ${w}` : w);
    }
    const failed = queue.items.filter((i) => i.status === 'error').length;
    if (!files.length) {
      renderFailure(L.panels.result.body, new Error('Unsupported'), { kind: 'docx', onRetry: () => run(), onChooseAnother: () => drop.open(), chooseLabel: 'ADD OTHER DOCUMENTS' });
      L.panels.result.show();
      return;
    }
    renderSuccess(L.panels.result.body, {
      files,
      tone: failed || warnings.size ? 'warn' : 'ok',
      message: failed ? `${plural(files.length, 'PDF')} created, ${failed} failed (see the queue above).` : `${plural(files.length, 'PDF')} created.`,
      extra: [warningsBlock([...warnings], 'THINGS THAT COULD NOT BE REPRODUCED')].filter(Boolean),
      zipName: 'word-to-pdf.zip',
      onAnother: () => {
        queue.clear();
        L.panels.result.hide();
      },
    });
    L.panels.result.show();
  }
}
