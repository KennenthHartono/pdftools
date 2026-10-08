/**
 * Application entry: home page, hash router, theme, mobile menu.
 *
 * Routes (hash based, so it works on any static host and any sub-path):
 *   #/<tool-id>   open a tool
 *   anything else show the home page (and scroll to #tools / #about / #privacy)
 */

import { CONFIG } from './config.js';
import { TOOLS, findTool } from './registry.js';
import { createScope } from './core/memory.js';
import { h, button } from './ui/components.js';
import { icon } from './ui/icons.js';
import { toast } from './ui/notifications.js';
import { humanizeError } from './core/errors.js';

const $ = (selector) => document.querySelector(selector);
const home = $('#home');
const toolView = $('#tool-view');
const toolMount = $('#tool-mount');

let activeScope = null;
let navigation = 0; // guards against out-of-order async loads

// ───────────────────────── tool cards ─────────────────────────

function buildCards() {
  const grid = $('#tool-grid');
  grid.replaceChildren(
    ...TOOLS.map((tool) =>
      h(
        'li',
        { class: `tool-card-wrap${tool.featured ? ' is-featured' : ''}` },
        h(
          'a',
          { class: 'tool-card', href: `#/${tool.id}`, 'aria-label': `${tool.title}: ${tool.short}` },
          h('span', { class: 'tool-card-top' }, h('span', { class: 'tool-card-num' }, tool.num), tool.featured ? h('span', { class: 'badge badge--accent' }, 'BATCH') : null),
          h('span', { class: 'tool-card-icon' }, icon(tool.icon, { size: 34 })),
          h('span', { class: 'tool-card-title' }, tool.title),
          h('span', { class: 'tool-card-text' }, tool.short),
          h('span', { class: 'tool-card-foot' }, h('span', { class: 'tool-card-formats' }, tool.formats), h('span', { class: 'tool-card-arrow', 'aria-hidden': 'true' }, icon('arrow', { size: 20 }))),
        ),
      ),
    ),
  );
}

// ───────────────────────── routing ─────────────────────────

async function route() {
  const token = ++navigation;
  const hash = location.hash;

  if (activeScope) {
    const old = activeScope;
    activeScope = null;
    await old.dispose();
  }
  if (token !== navigation) return;

  const match = /^#\/([a-z0-9-]+)$/.exec(hash);
  const tool = match ? findTool(match[1]) : null;

  if (!tool) {
    showHome(match ? null : hash);
    return;
  }

  home.hidden = true;
  toolView.hidden = false;
  toolView.classList.remove('is-entering');
  void toolView.offsetWidth; // restart the entrance animation
  toolView.classList.add('is-entering');
  document.title = `${tool.title} · DOCUMENT // LAB`;
  toolMount.replaceChildren(h('p', { class: 'loading', role: 'status' }, 'LOADING TOOL…'));
  window.scrollTo(0, 0);

  const scope = createScope();
  activeScope = scope;
  try {
    const module = await tool.load();
    if (token !== navigation) return;
    await module.mount(toolMount, { scope, meta: tool });
    toolMount.querySelector('#tool-title')?.focus({ preventScroll: true });
  } catch (error) {
    if (token !== navigation) return;
    const { title, message } = humanizeError(error);
    toolMount.replaceChildren(
      h(
        'div',
        { class: 'result result--error', role: 'alert' },
        h('h1', { class: 'result-title' }, title),
        h('p', { class: 'result-message' }, message),
        h('div', { class: 'result-actions' }, button({ label: 'TRY AGAIN', variant: 'primary', icon: 'retry', onClick: () => route() }), h('a', { class: 'btn btn--secondary btn--md', href: '#tools' }, 'BACK TO TOOLS')),
      ),
    );
  }
}

function showHome(hash) {
  toolView.hidden = true;
  home.hidden = false;
  document.title = 'DOCUMENT // LAB · Local PDF and Word tools';
  const target = hash && hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
  requestAnimationFrame(() => {
    if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
    else window.scrollTo(0, 0);
  });
}

// ───────────────────────── theme & menu ─────────────────────────

function initTheme() {
  const btn = $('#theme-toggle');
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    btn.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon', { size: 18 }));
  };
  let saved = null;
  try {
    saved = localStorage.getItem(CONFIG.themeStorageKey);
  } catch {
    /* storage blocked: fall back to the default theme */
  }
  apply(saved === 'dark' ? 'dark' : 'light'); // default is always the light vintage theme
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try {
      localStorage.setItem(CONFIG.themeStorageKey, next);
    } catch {
      /* ignore */
    }
  });
}

function initMenu() {
  const toggle = $('#menu-toggle');
  const nav = $('#site-nav');
  toggle.replaceChildren(icon('menu', { size: 22 }));
  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
}

// ───────────────────────── browser checks ─────────────────────────

function checkBrowser() {
  const missing = [];
  if (typeof Worker === 'undefined') missing.push('Web Workers');
  if (!HTMLCanvasElement.prototype.toBlob) missing.push('canvas export');
  if (typeof DOMParser === 'undefined') missing.push('XML parsing');
  if (typeof BigInt === 'undefined' || typeof Promise.allSettled !== 'function') missing.push('modern JavaScript');
  if (missing.length) {
    const banner = $('#browser-warning');
    banner.textContent = `This browser is missing features the tools need (${missing.join(', ')}). Please use a current version of Chrome, Edge, Firefox or Safari.`;
    banner.hidden = false;
  }
}

// ───────────────────────── start ─────────────────────────

function init() {
  // A file dropped outside a drop zone would make the browser navigate away and lose all work.
  for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault(); });

  document.querySelectorAll('[data-github-link]').forEach((a) => a.setAttribute('href', CONFIG.githubUrl));
  document.querySelectorAll('[data-version]').forEach((n) => { n.textContent = CONFIG.version; });
  $('#tool-count').textContent = String(TOOLS.length).padStart(2, '0');

  buildCards();
  initTheme();
  initMenu();
  checkBrowser();
  window.addEventListener('hashchange', route);
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[Document Lab] unhandled rejection', e.reason);
    toast('Something went wrong. Please try again.', { tone: 'error' });
  });
  route();
}

init();
