/** Tool UI: Multiple Word → ONE PDF */

import { createToolLayout, renderSuccess, renderFailure, warningsBlock } from '../ui/toolShell.js';
import { createDropZone } from '../ui/uploader.js';
import { createQueueView } from '../ui/queueView.js';
import { button, createProgressPanel, h } from '../ui/components.js';
import { toast } from '../ui/notifications.js';
import { FileQueue } from '../core/fileQueue.js';
import { convertAll, convertOne, mergeConverted } from '../word/wordBatchToPdf.js';
import { humanizeError } from '../core/errors.js';
import { plural } from '../core/utils.js';
import { DOCX_KIND, actionBar, toBlob, createAbort } from './common.js';

export async function mount(container, { scope, meta }) {
  const L = createToolLayout(container, meta, [
    { id: 'input', title: 'INPUT' },
    { id: 'queue', title: 'DOCUMENT QUEUE', hint: 'Drag rows or use ↑ ↓ to set the order' },
    { id: 'action', title: 'CONVERT & MERGE' },
    { id: 'result', title: 'FINAL RESULT', hidden: true },
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
    meta: (item) => (item.meta.pages ? plural(item.meta.pages, 'page') : ''),
    actions: (item) =>
      item.status === 'error' && !running
        ? [button({ label: 'RETRY', size: 'sm', icon: 'retry', onClick: () => retryOne(item) }), button({ label: 'SKIP', size: 'sm', onClick: () => queue.remove(item.id) })]
        : [],
    empty: { title: 'NO DOCUMENTS LOADED', body: 'Drop files into the workspace or select them from your device.', actionLabel: 'SELECT FILES', onAction: () => drop.open() },
  });
  scope.onDispose(() => view.destroy());
  L.panels.queue.body.append(view.el);

  const progress = createProgressPanel({ cancellable: true, onCancel: () => cancelCurrent?.abort() });
  let cancelCurrent = null;
  const runBtn = button({ label: 'CONVERT & MERGE', variant: 'primary', size: 'lg', icon: 'word-batch', disabled: true, onClick: () => run() });
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
    const converted = queue.items.filter((i) => results.has(i.id)).length;
    runBtn.disabled = running || !queue.length;
    runBtn.querySelector('.btn-label').textContent = failed ? 'RETRY FAILED' : converted === queue.length && converted ? 'MERGE AGAIN' : 'CONVERT & MERGE';
    hint.textContent = !queue.length
      ? 'Add at least one .docx file.'
      : failed
        ? `${failed} failed: retry, or skip them and merge the rest.`
        : `${plural(queue.length, 'document')} will be merged into one PDF.`;
    if (!queue.length) drop.setCompact(false);
  }
  refresh();

  async function retryOne(item) {
    queue.update(item.id, { status: 'processing', progress: 0, error: null });
    const outcome = await convertOne(item, results, { onItemProgress: (p) => queue.update(item.id, { progress: p }) });
    if (outcome.ok) queue.update(item.id, { status: 'completed', progress: 100, meta: { pages: results.get(item.id).pageCount } });
    else queue.update(item.id, { status: 'error', error: humanizeError(outcome.error, 'docx').message });
  }

  async function run() {
    if (running || !queue.length) return;
    running = true;
    cancelCurrent = new AbortController();
    abort.signal.addEventListener('abort', () => cancelCurrent.abort(), { once: true });
    view.setLocked(true);
    refresh();
    L.panels.result.hide();

    const total = queue.length;
    let finished = queue.items.filter((i) => results.has(i.id)).length;
    // Failed items from an earlier run are retried; completed ones keep their result.
    for (const item of queue.items) if (item.status === 'error') queue.update(item.id, { status: 'idle', error: null });
    progress.show('CONVERTING');
    try {
      await convertAll(queue.items.slice(), results, {
        signal: cancelCurrent.signal,
        onStart: (item) => {
          queue.update(item.id, { status: 'processing', progress: 0 });
          progress.update({ percent: (finished / total) * 90, label: `${finished} / ${total} documents processed. Current`, detail: item.name });
        },
        onItemProgress: (item, p) => {
          queue.update(item.id, { progress: p });
          progress.update({ percent: ((finished + p / 100) / total) * 90 });
        },
        onDone: (item, outcome) => {
          finished++;
          if (outcome.ok) queue.update(item.id, { status: 'completed', progress: 100, meta: { pages: results.get(item.id).pageCount } });
          else queue.update(item.id, { status: 'error', error: humanizeError(outcome.error, 'docx').message });
        },
      });

      const failed = queue.items.filter((i) => i.status === 'error');
      if (failed.length) {
        progress.hide();
        showReview(failed.length);
        return;
      }
      await merge();
    } catch (err) {
      progress.hide();
      for (const item of queue.items) if (item.status === 'processing') queue.update(item.id, { status: 'idle' });
      if (humanizeError(err).code === 'ABORTED') toast('Cancelled. Finished documents are kept; press the button to continue.');
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

  /** Some documents failed: let the user decide instead of silently dropping them. */
  function showReview(failedCount) {
    const converted = queue.items.filter((i) => results.has(i.id)).length;
    const body = L.panels.result.body;
    body.replaceChildren(
      h(
        'div',
        { class: 'result result--warn', role: 'alert' },
        h('h3', { class: 'result-title', tabindex: '-1' }, 'ATTENTION NEEDED'),
        h('p', { class: 'result-message' }, `${plural(failedCount, 'document')} could not be converted. Each failed file in the queue has RETRY and SKIP. You can also merge only the ${converted} that worked.`),
        h(
          'div',
          { class: 'result-actions' },
          button({ label: `MERGE ${converted} COMPLETED`, variant: 'primary', disabled: !converted, onClick: async () => {
            // Leave failed ones out of the merge; they stay in the queue for a later retry.
            running = true;
            view.setLocked(true);
            try {
              await merge();
            } finally {
              running = false;
              view.setLocked(false);
              refresh();
            }
          } }),
        ),
      ),
    );
    L.panels.result.show();
    body.querySelector('.result-title')?.focus({ preventScroll: true });
    body.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function merge() {
    progress.show('MERGING');
    try {
      const included = queue.items.filter((i) => results.has(i.id));
      const { bytes, pageCount, documents } = await mergeConverted(included, results, { onProgress: progress.update });
      progress.hide();
      const warnings = new Set();
      for (const item of included) for (const w of results.get(item.id).warnings) warnings.add(`${item.name}: ${w}`);
      const skipped = queue.length - included.length;
      renderSuccess(L.panels.result.body, {
        title: 'PROCESS COMPLETE',
        tone: warnings.size || skipped ? 'warn' : 'ok',
        message: `${plural(documents, 'document')} merged${skipped ? ` (${plural(skipped, 'failed document')} left out)` : ''}.`,
        files: [{ name: 'combined-document.pdf', blob: toBlob(bytes, 'application/pdf'), label: plural(pageCount, 'page') }],
        extra: [warningsBlock([...warnings], 'THINGS THAT COULD NOT BE REPRODUCED')].filter(Boolean),
        onAnother: () => {
          queue.clear();
          L.panels.result.hide();
        },
      });
      L.panels.result.show();
    } catch (err) {
      progress.hide();
      renderFailure(L.panels.result.body, err, { kind: 'pdf', onRetry: () => merge(), onChooseAnother: () => drop.open(), chooseLabel: 'ADD OTHER DOCUMENTS' });
      L.panels.result.show();
    }
  }
}
