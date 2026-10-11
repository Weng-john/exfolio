import type { OcrWord } from '@core/index';

// Text recognition for statement screenshots, run entirely in the browser.
// The engine and its language data are part of this site (copied in by
// scripts/vendor-ocr.mjs), so the picture is only ever handled by code that
// shipped with the build: nothing is fetched from, or sent to, another host.

export interface OcrProgress {
  /** What the engine is doing, in its own words. */
  status: string;
  /** 0..1 within the current phase. */
  progress: number;
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'];

export function isImageFile(file: File): boolean {
  return IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name);
}

/**
 * Enlarge only very small images. Ordinary screenshots are recognised best
 * as they are: enlarging them blurred the strokes and made results worse
 * in testing.
 */
async function prepare(file: File): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = bitmap.width < 600 ? 2 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width * scale;
  canvas.height = bitmap.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { canvas, scale };
}

interface EngineWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Recognise Traditional Chinese and English text, returning word boxes. */
export async function recognizeImage(
  file: File,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrWord[]> {
  // Loaded on demand: most visits never import a screenshot.
  const { createWorker } = await import('tesseract.js');
  const { canvas } = await prepare(file);
  const home = new URL('./vendor/ocr/', document.baseURI).href;
  const worker = await createWorker(['chi_tra', 'eng'], 1, {
    workerPath: `${home}worker.min.js`,
    corePath: home,
    langPath: `${home}lang`,
    // Load the worker from its own URL: a blob wrapper would hide where it came from.
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => onProgress?.(m),
  });
  try {
    // Statements are one block of aligned rows: telling the engine so keeps
    // each row together instead of reading the page column by column.
    await worker.setParameters({
      tessedit_pageseg_mode: '6' as never,
      preserve_interword_spaces: '1',
    });
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          for (const word of line.words as EngineWord[]) {
            words.push({ text: word.text, confidence: word.confidence, ...word.bbox });
          }
        }
      }
    }
    return words;
  } finally {
    await worker.terminate();
  }
}
