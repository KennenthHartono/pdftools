/**
 * Renders a FileQueue as an ordered list.
 *
 * Reordering works two ways so it is never pointer-only:
 *   - drag a row (HTML5 drag & drop)
 *   - the ↑ / ↓ buttons on every row (keyboard and touch friendly)
 */

import { h, button, iconButton, emptyState } from './components.js';
import { pad, formatBytes, extOf, plural } from '../core/utils.js';

/** Tag a button so keyboard focus can be restored after the list re-renders. */
function keyed(btn, key) {
  btn.setAttribute('data-focus-key', key);
  return btn;
}

const STATUS_TEXT = {
  idle: 'QUEUED',
  processing: 'PROCESSING',
  completed: 'DONE',
  error: 'FAILED',
};

/**
 * @param {object} config
 * @param {import('../core/fileQueue.js').FileQueue} config.queue
 * @param {boolean} [config.reorder=true]
 * @param {boolean} [config.showIdleStatus=false]  Show the QUEUED chip for idle items.
 * @param {(item: import('../core/fileQueue.js').QueueItem) => string} [config.meta]  Extra meta text (e.g. "12 pages").
 * @param {(item: import('../core/fileQueue.js').QueueItem) => Node | null} [config.thumb]
 * @param {(item: import('../core/fileQueue.js').QueueItem) => Node[]} [config.actions]  Extra per-row buttons.
 * @param {{title: string, body: string, actionLabel?: string, onAction?: () => void}} config.empty
 * @param {string} [config.unit]  Noun for the header count, e.g. "file".
 */
export function createQueueView({ queue, reorder = true, showIdleStatus = false, meta, thumb, actions, empty, unit = 'file' }) {
  let locked = false;
  let scheduled = false;
  let draggingId = null;

  const countLabel = h('span', { class: 'queue-count' });
  const clearBtn = button({ label: 'CLEAR QUEUE', variant: 'ghost', size: 'sm', icon: 'trash', onClick: () => queue.clear() });
  const list = h('ol', { class: 'queue-list', 'aria-label': 'File queue' });
  const emptyEl = emptyState(empty);
  const el = h('div', { class: 'queue' }, h('div', { class: 'queue-head' }, countLabel, clearBtn), list, emptyEl);

  function render() {
    scheduled = false;
    const items = queue.items;

    // Remember keyboard focus so reordering with the buttons doesn't lose it.
    const active = document.activeElement;
    const focusKey = active && el.contains(active) ? active.getAttribute('data-focus-key') : null;

    const total = items.reduce((sum, i) => sum + i.size, 0);
    countLabel.textContent = items.length ? `${plural(items.length, unit).toUpperCase()}  ·  ${formatBytes(total)}` : `NO ${unit.toUpperCase()}S LOADED`;
    clearBtn.hidden = locked || !items.length;
    list.hidden = !items.length;
    emptyEl.hidden = items.length > 0;

    list.replaceChildren(
      ...items.map((item, index) => {
        const ext = extOf(item.name).toUpperCase() || 'FILE';
        const metaText = [formatBytes(item.size), meta?.(item)].filter(Boolean).join('  ·  ');

        const row = h(
          'li',
          { class: `queue-item queue-item--${item.status}`, dataset: { id: item.id }, draggable: reorder && !locked },
          reorder && !locked ? h('span', { class: 'queue-grip', 'aria-hidden': 'true' }, '⋮⋮') : null,
          h('span', { class: 'queue-index' }, pad(index + 1)),
          thumb?.(item) ?? h('span', { class: 'file-badge' }, ext.slice(0, 5)),
          h(
            'div',
            { class: 'queue-main' },
            h('span', { class: 'queue-name', title: item.name }, item.name),
            h('span', { class: 'queue-meta' }, metaText),
            item.status === 'error' && item.error ? h('span', { class: 'queue-error', role: 'alert' }, item.error) : null,
            item.status === 'processing' ? h('span', { class: 'queue-progress' }, h('span', { style: `width:${Math.round(item.progress)}%` })) : null,
          ),
          item.status !== 'idle' || showIdleStatus
            ? h('span', { class: `chip chip--${item.status}` }, item.status === 'processing' ? `${Math.round(item.progress)}%` : STATUS_TEXT[item.status])
            : null,
          h(
            'div',
            { class: 'queue-actions' },
            ...(actions?.(item) ?? []),
            ...(locked
              ? []
              : [
                  reorder ? keyed(iconButton({ icon: 'up', label: `Move ${item.name} up`, disabled: index === 0, onClick: () => queue.move(item.id, -1) }), `${item.id}:up`) : null,
                  reorder ? keyed(iconButton({ icon: 'down', label: `Move ${item.name} down`, disabled: index === items.length - 1, onClick: () => queue.move(item.id, 1) }), `${item.id}:down`) : null,
                  keyed(iconButton({ icon: 'close', label: `Remove ${item.name}`, onClick: () => queue.remove(item.id), className: 'icon-btn--danger' }), `${item.id}:remove`),
                ]),
          ),
        );

        return row;
      }),
    );

    if (focusKey) {
      const target = [...list.querySelectorAll('[data-focus-key]')].find((n) => n.getAttribute('data-focus-key') === focusKey && !n.disabled);
      // If the same button is now disabled (item reached the end), fall back to its sibling.
      if (target) target.focus();
      else {
        const id = focusKey.split(':')[0];
        list.querySelector(`[data-id="${id}"] .queue-actions button:not([disabled])`)?.focus();
      }
    }
  }

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  };

  const unsubscribe = queue.subscribe(schedule);

  // ----- drag & drop reordering (event delegation) -----
  const rowOf = (target) => /** @type {HTMLElement | null} */ (target.closest?.('.queue-item'));
  const clearMarks = () => list.querySelectorAll('.drop-before, .drop-after, .is-dragging').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'is-dragging'));

  list.addEventListener('dragstart', (e) => {
    const row = rowOf(e.target);
    if (!row || locked) return;
    draggingId = row.dataset.id;
    row.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggingId);
  });
  list.addEventListener('dragover', (e) => {
    if (!draggingId) return;
    const row = rowOf(e.target);
    if (!row) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    list.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    if (row.dataset.id !== draggingId) row.classList.add(before ? 'drop-before' : 'drop-after');
  });
  list.addEventListener('drop', (e) => {
    if (!draggingId) return;
    const row = rowOf(e.target);
    if (!row) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const dragged = draggingId;
    draggingId = null;
    clearMarks();
    if (row.dataset.id === dragged) return;
    const ids = queue.items.map((i) => i.id).filter((id) => id !== dragged);
    queue.moveTo(dragged, ids.indexOf(row.dataset.id) + (before ? 0 : 1));
  });
  list.addEventListener('dragend', () => {
    draggingId = null;
    clearMarks();
  });

  render();

  return {
    el,
    /** Hide reorder/remove controls while a job is running. */
    setLocked(value) {
      locked = value;
      el.classList.toggle('is-locked', value);
      render();
    },
    destroy() {
      unsubscribe();
    },
  };
}
