// Pure-function tests. Run: npm run test:unit  (Node 18+, no browser needed)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRanges, describeRange } from '../js/pdf/splitPdf.js';
import { computePlacement, readJpegOrientation } from '../js/image/imagesToPdf.js';
import { formatBytes, baseName, extOf, uniqueName, safeFileName, percentSaved, plural, pad } from '../js/core/utils.js';

test('parseRanges: pages, ranges, open-ended', () => {
  assert.deepEqual(parseRanges('1-3, 5, 8-10', 10).ranges, [{ start: 1, end: 3 }, { start: 5, end: 5 }, { start: 8, end: 10 }]);
  assert.deepEqual(parseRanges('7-', 9).ranges, [{ start: 7, end: 9 }]);
  assert.deepEqual(parseRanges(' 2 ; 4 ', 5).ranges, [{ start: 2, end: 2 }, { start: 4, end: 4 }]);
});
test('parseRanges: errors', () => {
  for (const [text, n] of [['', 5], ['abc', 5], ['0', 5], ['6', 5], ['5-2', 9], ['1-99', 5], ['1--3', 5]]) {
    const r = parseRanges(text, n);
    assert.ok(r.error, `expected error for "${text}"`);
    assert.equal(r.ranges.length, 0);
  }
});
test('describeRange', () => {
  assert.equal(describeRange({ start: 3, end: 3 }), 'page 3');
  assert.equal(describeRange({ start: 3, end: 5 }), 'pages 3–5');
});

test('computePlacement: A4 contain keeps ratio and centres', () => {
  const p = computePlacement({ pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', imgW: 1000, imgH: 500 });
  assert.ok(p.pageW > p.pageH, 'wide image => landscape');
  assert.ok(Math.abs(p.w / p.h - 2) < 1e-9);
  assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= p.pageW && p.y + p.h <= p.pageH);
  assert.equal(p.clip, null);
});
test('computePlacement: cover fills box and clips', () => {
  const p = computePlacement({ pageSize: 'letter', orientation: 'portrait', marginMm: 0, fit: 'cover', imgW: 1000, imgH: 500 });
  assert.equal(p.pageW, 612);
  assert.ok(p.h >= 792 - 1e-6);
  assert.ok(p.clip);
});
test('computePlacement: original size uses px→pt and margin', () => {
  const p = computePlacement({ pageSize: 'original', orientation: 'auto', marginMm: 0, fit: 'contain', imgW: 400, imgH: 200 });
  assert.equal(p.pageW, 300);
  assert.equal(p.pageH, 150);
});

test('readJpegOrientation: no EXIF / not JPEG => 1', () => {
  assert.equal(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 0, 0, 0, 0])), 1);
  assert.equal(readJpegOrientation(new Uint8Array([1, 2, 3])), 1);
});
test('readJpegOrientation: reads big- and little-endian EXIF', () => {
  const build = (little, value) => {
    const u16 = (v) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
    const u32 = (v) => (little ? [v & 255, (v >> 8) & 255, 0, 0] : [0, 0, (v >> 8) & 255, v & 255]);
    const tiff = [little ? 0x49 : 0x4d, little ? 0x49 : 0x4d, ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0, ...u32(0)];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const len = body.length + 2;
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...body, 0xff, 0xda, 0, 0, 0, 0]);
  };
  assert.equal(readJpegOrientation(build(false, 6)), 6);
  assert.equal(readJpegOrientation(build(true, 8)), 8);
});

test('utils', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(-1), '—');
  assert.equal(baseName('a.b.pdf'), 'a.b');
  assert.equal(baseName('.hidden'), '.hidden');
  assert.equal(extOf('X.PDF'), 'pdf');
  assert.equal(extOf('noext'), '');
  const used = new Set();
  assert.deepEqual([uniqueName('a.pdf', used), uniqueName('a.pdf', used), uniqueName('a.pdf', used)], ['a.pdf', 'a (2).pdf', 'a (3).pdf']);
  assert.equal(safeFileName('a/b:c?.pdf'), 'a_b_c_.pdf');
  assert.equal(safeFileName('  '), 'file');
  assert.equal(percentSaved(100, 40), 60);
  assert.equal(percentSaved(100, 120), -20);
  assert.equal(percentSaved(0, 5), 0);
  assert.equal(plural(1, 'page'), '1 page');
  assert.equal(plural(2, 'page'), '2 pages');
  assert.equal(pad(3), '03');
});
