/** Small, dependency-free helpers shared by every module. */

/**
 * @param {number} bytes
 * @returns {string} e.g. "1.4 MB"
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

/** File name without its last extension. */
export function baseName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Lower-case extension without the dot ("" when there is none). */
export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > -1 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

/** Zero-pad a number: pad(3) → "03". */
export function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

/**
 * Make a file name unique inside a set of already used names
 * ("a.pdf", "a (2).pdf", ...). The returned name is added to `used`.
 * @param {string} name
 * @param {Set<string>} used
 */
export function uniqueName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const ext = extOf(name);
  const stem = baseName(name);
  let n = 2;
  let candidate;
  do {
    candidate = ext ? `${stem} (${n}).${ext}` : `${stem} (${n})`;
    n++;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

/** Strip characters that are illegal in file names on common platforms. */
export function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'file';
}

/** Resolve on the next macrotask so the browser can paint progress updates. */
export function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Plural helper: plural(1, "page") → "1 page", plural(2, "page") → "2 pages". */
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Percentage saved, rounded to a whole number (can be negative). */
export function percentSaved(original, result) {
  if (!original) return 0;
  return Math.round(((original - result) / original) * 100);
}
