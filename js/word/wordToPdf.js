/**
 * Word → PDF for one document, through the converter abstraction.
 */

import { getConverter } from './converter.js';
import { AppError, humanizeError } from '../core/errors.js';

export { LIMITATIONS } from './limitations.js';

/**
 * @param {File} file
 * @param {import('./converter.js').ConvertOptions} [options]
 * @returns {Promise<import('./converter.js').ConversionResult>}
 */
export async function convertWordToPdf(file, options) {
  try {
    return await getConverter().convert(file, options);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const { message } = humanizeError(err, 'docx');
    throw new AppError(message, { title: 'UNABLE TO CONVERT THIS DOCUMENT', code: 'UNSUPPORTED', cause: err });
  }
}
