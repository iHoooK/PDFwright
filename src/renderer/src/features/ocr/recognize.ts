import { createWorker, OEM, type Worker } from 'tesseract.js'
import { ocrWordsFromBlocks, type OcrWord } from '@shared/pdf-ops/ocr-layer'

/**
 * Распознавание текста на tesseract.js. Всё своё: worker, ядро WASM и
 * языковые данные копируются в public/ocr (scripts/copy-ocr-assets.mjs) и
 * грузятся по app://renderer/ocr/, в сеть программа не ходит. Распознавание
 * идёт в Web Worker tesseract; остановка — завершение этого worker.
 */

const ASSETS = new URL('ocr/', document.baseURI).href

export type OcrLanguage = 'rus' | 'eng' | 'rus+eng'

export interface OcrEngine {
  /** Слова с рамками в пикселях картинки; onProgress — доля 0…1 распознавания страницы. */
  recognize: (image: Uint8Array, onProgress: (fraction: number) => void) => Promise<OcrWord[]>
  terminate: () => Promise<void>
}

export async function createOcrEngine(language: OcrLanguage): Promise<OcrEngine> {
  let progress: ((fraction: number) => void) | null = null
  const worker: Worker = await createWorker(language, OEM.LSTM_ONLY, {
    workerPath: `${ASSETS}worker.min.js`,
    // Ядро с SIMD есть во всех версиях Chromium, на которых работает Electron 45.
    corePath: `${ASSETS}tesseract-core-simd-lstm.js`,
    langPath: `${ASSETS}lang`,
    gzip: true,
    // Данные лежат в программе — копия в IndexedDB не нужна.
    cacheMethod: 'none',
    // Worker грузится по своему адресу app://renderer/ocr/ — рядом с ним ядро и .wasm.
    workerBlobURL: false,
    logger: (message) => {
      if (message.status === 'recognizing text') progress?.(message.progress)
    }
  })
  return {
    recognize: async (image, onProgress) => {
      progress = onProgress
      try {
        const result = await worker.recognize(image, {}, { blocks: true, text: false })
        return ocrWordsFromBlocks(result.data.blocks)
      } finally {
        progress = null
      }
    },
    terminate: () => worker.terminate().then(() => undefined)
  }
}

/** Ширина и высота картинки PNG из заголовка IHDR. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
