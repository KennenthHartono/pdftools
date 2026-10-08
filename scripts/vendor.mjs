// Copies the third-party runtime files from node_modules into /vendor and /assets/fonts.
// Run with:  npm install && npm run vendor
// The copied files are committed, so deploying never requires npm.
import { cpSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const out = (p) => join(root, p);

function copy(from, to) {
  if (!existsSync(from)) throw new Error(`Missing ${from} - run "npm install" first.`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log('  +', to.replace(root + '/', ''));
}

// pdf-lib (ES module build, no bare imports)
copy(nm('pdf-lib/dist/pdf-lib.esm.min.js'), out('vendor/pdf-lib/pdf-lib.esm.min.js'));
copy(nm('pdf-lib/LICENSE.md'), out('vendor/pdf-lib/LICENSE.md'));

// PDF.js - the "legacy" build runs on older browsers than the default build
copy(nm('pdfjs-dist/legacy/build/pdf.min.mjs'), out('vendor/pdfjs/pdf.min.mjs'));
copy(nm('pdfjs-dist/legacy/build/pdf.worker.min.mjs'), out('vendor/pdfjs/pdf.worker.min.mjs'));
copy(nm('pdfjs-dist/LICENSE'), out('vendor/pdfjs/LICENSE'));
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(nm(`pdfjs-dist/${dir}`), out(`vendor/pdfjs/${dir}`), { recursive: true });
  console.log('  +', `vendor/pdfjs/${dir}/`);
}

// fflate (ZIP read/write, ES module)
copy(nm('fflate/esm/browser.js'), out('vendor/fflate/fflate.esm.js'));
copy(nm('fflate/LICENSE'), out('vendor/fflate/LICENSE'));

// Self-hosted fonts (latin subset) - no requests to Google Fonts
copy(nm('@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2'), out('assets/fonts/archivo-latin-wdth-normal.woff2'));
for (const w of ['400', '600']) copy(nm(`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${w}-normal.woff2`), out(`assets/fonts/ibm-plex-sans-latin-${w}-normal.woff2`));
for (const w of ['400', '500']) copy(nm(`@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-${w}-normal.woff2`), out(`assets/fonts/ibm-plex-mono-latin-${w}-normal.woff2`));
console.log('Done.');
