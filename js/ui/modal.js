/**
 * Dialogs built on the native <dialog> element: focus trapping, Escape to
 * close and the backdrop come from the browser, which keeps this accessible.
 */

import { h, button } from './components.js';

/**
 * Ask the user to confirm something.
 * @param {{title: string, body: string, confirmLabel?: string, cancelLabel?: string, tone?: 'warn'|'neutral'}} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body, confirmLabel = 'CONTINUE', cancelLabel = 'CANCEL', tone = 'warn' }) {
  if (typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) {
    // Very old browser: fall back to the built-in prompt rather than failing silently.
    return Promise.resolve(window.confirm(`${title}\n\n${body}`));
  }

  return new Promise((resolve) => {
    const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    const dialog = /** @type {HTMLDialogElement} */ (
      h(
        'dialog',
        { class: `modal modal--${tone}`, 'aria-labelledby': titleId },
        h(
          'form',
          { method: 'dialog' },
          h('p', { class: 'modal-tag' }, tone === 'warn' ? 'CAUTION' : 'NOTICE'),
          h('h2', { class: 'modal-title', id: titleId }, title),
          h('p', { class: 'modal-body' }, body),
          h(
            'div',
            { class: 'modal-actions' },
            button({ label: cancelLabel, variant: 'ghost', type: 'submit', className: 'js-cancel' }),
            button({ label: confirmLabel, variant: 'primary', type: 'submit', className: 'js-confirm' }),
          ),
        ),
      )
    );

    dialog.querySelector('.js-confirm').addEventListener('click', () => {
      dialog.dataset.result = 'yes';
    });
    dialog.addEventListener('close', () => {
      const ok = dialog.dataset.result === 'yes';
      dialog.remove();
      resolve(ok);
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('.js-cancel')?.focus();
  });
}
