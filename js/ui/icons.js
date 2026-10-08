/**
 * Icon set: small stroke icons, drawn on a 24×24 grid.
 * The SVG markup below is a fixed constant owned by this file (never built
 * from document content), so parsing it with innerHTML is safe.
 */

const PAGE = '<path d="M6 2.75h8.5L19 7.25v14H6z"/><path d="M14.5 2.75v4.5H19"/>';

const PATHS = {
  'pdf-to-images': `${PAGE}<circle cx="10.5" cy="12" r="1.1"/><path d="M8 19l3.2-3.6 2.3 2.4 1.7-1.7 1.8 2.9"/>`,
  merge: '<path d="M3 6.5h5c3.2 0 4.2 2.4 5 5.5"/><path d="M3 17.5h5c3.2 0 4.2-2.4 5-5.5"/><path d="M13 12h8"/><path d="M18 9l3 3-3 3"/>',
  split: '<path d="M3 12h8"/><path d="M11 12c.8-3.1 1.8-5.5 5-5.5h5"/><path d="M11 12c.8 3.1 1.8 5.5 5 5.5h5"/><path d="M18.5 3.5l2.5 3-2.5 3"/><path d="M18.5 14.5l2.5 3-2.5 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.5 3.5v4.6h-4.6"/>',
  'images-to-pdf': '<rect x="2.75" y="4.5" width="12.5" height="11" rx="1.5"/><circle cx="7" cy="8.5" r="1.1"/><path d="M3 14l3.6-3.4 2.7 2.4 2-1.8L15 14"/><path d="M17 17.5h4.25M19.1 15.4l2.15 2.1-2.15 2.1"/>',
  compress: '<path d="M3.5 9h5.5V3.5"/><path d="M20.5 9H15V3.5"/><path d="M3.5 15H9v5.5"/><path d="M20.5 15H15v5.5"/>',
  'word-to-pdf': `${PAGE}<path d="M8.3 10.5l1.6 6.5 1.6-4.6 1.6 4.6 1.6-6.5" stroke-width="1.5"/>`,
  'word-batch': '<path d="M9.5 2.75H16l3.25 3.25v9.5H9.5z"/><path d="M16 2.75V6h3.25"/><path d="M6.5 6.25H5v13.5h10.75"/><path d="M3 9.25v13h10.5" opacity=".55"/><path d="M12.2 9.5l1 4 1-2.8 1 2.8 1-4" stroke-width="1.4"/>',
  arrow: '<path d="M4 12h15"/><path d="M13.5 6.5L19 12l-5.5 5.5"/>',
  'arrow-down': '<path d="M12 4v15"/><path d="M6.5 13.5L12 19l5.5-5.5"/>',
  up: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  warn: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
  download: '<path d="M12 3.5v12"/><path d="M6.5 10.5L12 16l5.5-5.5"/><path d="M4 20.5h16"/>',
  upload: '<path d="M12 16.5v-12"/><path d="M6.5 9.5L12 4l5.5 5.5"/><path d="M4 20.5h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="2.6"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M3.5 3.5v4.6h4.6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 13h9.4l.8-13"/>',
};

/**
 * @param {keyof typeof PATHS | string} name
 * @param {{size?: number, className?: string}} [options]
 * @returns {SVGElement}
 */
export function icon(name, { size = 20, className = '' } = {}) {
  const template = document.createElement('template');
  template.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${PATHS[name] ?? PATHS.info}</svg>`;
  const svg = /** @type {SVGElement} */ (template.content.firstElementChild);
  if (className) svg.setAttribute('class', className);
  return svg;
}
