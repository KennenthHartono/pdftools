/**
 * Error handling: every failure shown to the user goes through humanizeError(),
 * so raw exception names such as "UnhandledPromiseRejection" never reach the UI.
 */

/**
 * An error whose message is already written for humans.
 */
export class AppError extends Error {
  /**
   * @param {string} message  Human-readable explanation.
   * @param {object} [options]
   * @param {string} [options.title] Short headline.
   * @param {string} [options.code]  Machine code (ENCRYPTED, CORRUPT, UNSUPPORTED, MEMORY, INPUT, ABORTED).
   * @param {unknown} [options.cause]
   */
  constructor(message, { title, code = 'APP', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.title = title;
    this.code = code;
  }
}

/** Thrown when the user cancels a running operation. */
export class AbortedError extends AppError {
  constructor() {
    super('The operation was cancelled.', { title: 'CANCELLED', code: 'ABORTED' });
  }
}

/** @param {AbortSignal} [signal] */
export function throwIfAborted(signal) {
  if (signal?.aborted) throw new AbortedError();
}

const KIND_LABEL = {
  pdf: 'PDF',
  image: 'image',
  docx: 'document',
  file: 'file',
};

/**
 * Convert any thrown value into `{ title, message, code }` for display.
 * @param {unknown} error
 * @param {'pdf'|'image'|'docx'|'file'} [kind='file']
 */
export function humanizeError(error, kind = 'file') {
  const noun = KIND_LABEL[kind] ?? 'file';
  if (error instanceof AppError) {
    return {
      title: error.title ?? `UNABLE TO PROCESS THIS ${noun.toUpperCase()}`,
      message: error.message,
      code: error.code,
    };
  }

  const text = `${error?.name ?? ''} ${error?.message ?? ''}`;

  if (/encrypt|password/i.test(text)) {
    return {
      title: 'PASSWORD-PROTECTED PDF',
      message:
        'This PDF is encrypted or needs a password. Remove the protection in the program that created it, then try again.',
      code: 'ENCRYPTED',
    };
  }
  if (/out of memory|allocation failed|invalid (array|typed array) length|Array buffer allocation/i.test(text)) {
    return {
      title: 'NOT ENOUGH MEMORY',
      message:
        'The browser ran out of memory while working on this file. Try a smaller file, fewer files at once, or a lower resolution.',
      code: 'MEMORY',
    };
  }
  if (/InvalidPDF|No PDF header|Failed to parse PDF|Invalid PDF|bad XRef|Missing PDF|Expected instance of PDF/i.test(text)) {
    return {
      title: 'UNABLE TO PROCESS THIS PDF',
      message:
        'The file may be corrupted or use a PDF feature that this browser-based tool does not currently support.',
      code: 'CORRUPT',
    };
  }
  if (/AbortException|RenderingCancelled/i.test(text)) {
    return { title: 'CANCELLED', message: 'The operation was cancelled.', code: 'ABORTED' };
  }
  if (/Failed to fetch dynamically imported|Importing a module script failed|error loading dynamically imported/i.test(text)) {
    return {
      title: 'COMPONENT FAILED TO LOAD',
      message:
        'A required script could not be loaded. Check your connection (or that the site files are complete) and try again.',
      code: 'LOAD',
    };
  }

  // Log the technical detail for developers; show a calm message to users.
  console.error('[Document Lab]', error);
  return {
    title: `UNABLE TO PROCESS THIS ${noun.toUpperCase()}`,
    message: `The file may be corrupted or use a feature that this browser-based tool does not currently support.`,
    code: 'UNKNOWN',
  };
}
