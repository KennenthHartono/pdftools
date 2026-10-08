/**
 * Notifications: visual toasts plus a hidden live region for screen readers.
 * The containers (#toasts, #sr-status) live in index.html.
 */

import { icon } from './icons.js';

/**
 * Speak a message to assistive technology without showing anything.
 * @param {string} message
 */
export function announce(message) {
  const region = document.getElementById('sr-status');
  if (!region) return;
  region.textContent = '';
  // Re-setting text on the next frame makes screen readers re-announce repeats.
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

/**
 * Show a short-lived toast.
 * @param {string} message
 * @param {{tone?: 'info'|'success'|'error'|'warn', timeout?: number}} [options]
 */
export function toast(message, { tone = 'info', timeout = 6000 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;

  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');

  const iconName = tone === 'success' ? 'check' : tone === 'error' || tone === 'warn' ? 'warn' : 'info';
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message; // textContent: file names can never inject markup

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.append(icon('close', { size: 16 }));

  el.append(icon(iconName, { size: 18, className: 'toast-icon' }), text, close);
  host.append(el);

  const remove = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  close.addEventListener('click', remove);
  if (timeout > 0) setTimeout(remove, timeout);
  while (host.children.length > 4) host.firstElementChild.remove();
}
