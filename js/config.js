/**
 * Central configuration. Change values here, not in the feature modules.
 */
export const CONFIG = Object.freeze({
  appName: 'DOCUMENT // LAB',
  version: '1.0.0',

  /** Replace with your repository. The footer link reads this value at start-up. */
  githubUrl: 'https://github.com/YOUR_USERNAME/YOUR_REPOSITORY',

  /** Files larger than this trigger a "LARGE FILE" confirmation before loading. */
  largeFileBytes: 50 * 1024 * 1024,

  /**
   * Upper bound for the pixel count of a single canvas. iOS Safari rejects
   * canvases above roughly 16.7 million pixels, so we stay just under that.
   */
  maxCanvasPixels: 16_000_000,

  /** Longest edge (CSS px) of a page thumbnail. */
  thumbnailSize: 140,

  /** localStorage key for the theme choice (the only thing this app stores). */
  themeStorageKey: 'document-lab-theme',
});
