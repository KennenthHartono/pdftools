/** Tool UI: Images → PDF */

import { createToolLayout, renderSuccess, renderFailure } from '../ui/toolShell.js';
import { createDropZone } from '../ui/uploader.js';
import { createQueueView } from '../ui/queueView.js';
import { selectField, numberField, radioGroup } from '../ui/controls.js';
import { button, createProgressPanel, h } from '../ui/components.js';
import { toast } from '../ui/notifications.js';
import { FileQueue } from '../core/fileQueue.js';
import { imagesToPdf } from '../image/imagesToPdf.js';
import { humanizeError } from '../core/errors.js';
import { plural } from '../core/utils.js';
import { IMAGE_KIND, actionBar, toBlob, createAbort, setBusy } from './common.js';

export async function mount(container, { scope, meta }) {
  const L = createToolLayout(container, meta, [
    { id: 'input', title: 'INPUT' },
    { id: 'queue', title: 'IMAGE QUEUE', hint: 'One image per page, in this order' },
    { id: 'options', title: 'PAGE SETTINGS' },
    { id: 'action', title: 'CREATE' },
    { id: 'result', title: 'RESULT', hidden: true },
  ]);
  const abort = createAbort(scope);
  const queue = new FileQueue();
  const urls = new Map();
  let running = false;

  const drop = createDropZone({
    kind: IMAGE_KIND,
    multiple: true,
    title: 'DROP IMAGES HERE',
    hint: 'JPG · PNG · WebP  ·  processed locally',
    onFiles: (files) => {
      drop.setCompact(true);
      L.panels.result.hide();
      for (const item of queue.add(files)) urls.set(item.id, scope.url(item.file));
    },
  });
  L.panels.input.body.append(drop.el);

  // Release preview URLs for removed images.
  scope.onDispose(
    queue.subscribe((items) => {
      const alive = new Set(items.map((i) => i.id));
      for (const [id, url] of urls) {
        if (!alive.has(id)) {
          scope.revoke(url);
          urls.delete(id);
        }
      }
    }),
  );

  const view = createQueueView({
    queue,
    unit: 'image',
    thumb: (item) => h('img', { class: 'queue-thumb', src: urls.get(item.id), alt: '', loading: 'lazy' }),
    empty: { title: 'NO IMAGES LOADED', body: 'Drop files into the workspace or select them from your device.', actionLabel: 'SELECT IMAGES', onAction: () => drop.open() },
  });
  scope.onDispose(() => view.destroy());
  L.panels.queue.body.append(view.el);

  const pageSize = selectField({
    label: 'PAGE SIZE',
    value: 'a4',
    options: [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'original', label: 'Original (image size)' }],
    onChange: sync,
  });
  const orientation = selectField({ label: 'ORIENTATION', value: 'auto', options: [{ value: 'auto', label: 'Auto (match image)' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] });
  const margin = numberField({ label: 'MARGIN', min: 0, max: 50, step: 1, value: 10, suffix: 'mm' });
  const fit = radioGroup({
    legend: 'IMAGE FIT',
    value: 'contain',
    options: [{ value: 'contain', label: 'CONTAIN', hint: 'whole image visible' }, { value: 'cover', label: 'COVER', hint: 'fill page, crop edges' }],
  });
  L.panels.options.body.append(h('div', { class: 'form-grid' }, pageSize.el, orientation.el, margin.el, fit.el));
  function sync() {
    orientation.setDisabled(pageSize.value === 'original');
  }

  const progress = createProgressPanel({ cancellable: false });
  const createBtn = button({ label: 'CREATE PDF', variant: 'primary', size: 'lg', icon: 'images-to-pdf', disabled: true, onClick: run });
  const hint = h('p', { class: 'action-hint', 'aria-live': 'polite' });
  L.panels.action.body.append(actionBar(button({ label: 'ADD IMAGES', icon: 'plus', onClick: () => drop.open() }), createBtn, hint), progress.el);

  function refresh() {
    createBtn.disabled = running || !queue.length;
    hint.textContent = queue.length ? `${plural(queue.length, 'page')} will be created.` : 'Add at least one image.';
    if (!queue.length) drop.setCompact(false);
  }
  scope.onDispose(queue.subscribe(refresh));
  refresh();
  sync();

  async function run() {
    if (running || !queue.length) return;
    const m = margin.value;
    if (!Number.isFinite(m) || m < 0 || m > 50) {
      toast('Margin must be between 0 and 50 mm.', { tone: 'warn' });
      return;
    }
    running = true;
    view.setLocked(true);
    setBusy(true, pageSize, orientation, margin, fit);
    refresh();
    L.panels.result.hide();
    progress.show('CREATING PDF');
    try {
      const { bytes, pageCount, reencoded } = await imagesToPdf(queue.items.map((i) => i.file), {
        pageSize: pageSize.value,
        orientation: orientation.value,
        marginMm: m,
        fit: fit.value,
        onProgress: progress.update,
        signal: abort.signal,
      });
      progress.hide();
      const extra = reencoded ? [h('p', { class: 'note-line' }, `${plural(reencoded, 'image')} (WebP or rotated photos) had to be re-encoded before embedding; the others were embedded unchanged.`)] : [];
      renderSuccess(L.panels.result.body, {
        files: [{ name: 'images.pdf', blob: toBlob(bytes, 'application/pdf'), label: plural(pageCount, 'page') }],
        message: 'Your file is ready.',
        extra,
        onAnother: () => {
          queue.clear();
          L.panels.result.hide();
        },
      });
      L.panels.result.show();
    } catch (err) {
      progress.hide();
      if (humanizeError(err).code === 'ABORTED') toast('Cancelled.');
      else {
        renderFailure(L.panels.result.body, err, { kind: 'image', onRetry: run, onChooseAnother: () => drop.open(), chooseLabel: 'ADD OTHER IMAGES' });
        L.panels.result.show();
      }
    } finally {
      running = false;
      view.setLocked(false);
      setBusy(false, pageSize, orientation, margin, fit);
      sync();
      refresh();
    }
  }
}
