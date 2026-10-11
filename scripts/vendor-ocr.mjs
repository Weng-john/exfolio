#!/usr/bin/env node
// Copies the text-recognition engine and its language data out of
// node_modules so the site serves them itself. Statement screenshots are
// then processed by code that came with this build, pinned by the lockfile,
// instead of code fetched from a CDN at run time.

import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const out = path.resolve('public/vendor/ocr');
const from = (...parts) => path.resolve('node_modules', ...parts);

const files = [
  [from('tesseract.js/dist/worker.min.js'), 'worker.min.js'],
  // The engine picks one of these at run time by what the browser supports.
  [from('tesseract.js-core/tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [from('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [
    from('tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js'),
    'tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
  [
    from('@tesseract.js-data/chi_tra/4.0.0_best_int/chi_tra.traineddata.gz'),
    'lang/chi_tra.traineddata.gz',
  ],
  [from('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), 'lang/eng.traineddata.gz'],
];

let bytes = 0;
for (const [source, name] of files) {
  const target = path.join(out, name);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  bytes += (await stat(target)).size;
}
console.log(`ocr: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB → ${out}`);
