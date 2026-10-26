// Копирует файлы распознавания текста (tesseract.js) в public-папку renderer:
// worker, ядро WASM (вариант SIMD только с LSTM), языковые данные rus и eng
// и тексты лицензий (Apache-2.0).
// Программа не ходит за ними в сеть: всё грузится по app://renderer/ocr/.
// Ядро лежит рядом с worker — emscripten ищет .wasm в папке скрипта worker.
// Папка не хранится в git и собирается перед dev и build.
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modules = join(root, 'node_modules')
const target = join(root, 'src', 'renderer', 'public', 'ocr')

const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js/dist/worker.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt'],
  ['tesseract.js/LICENSE.md', 'LICENSE-tesseract.js.txt'],
  ['tesseract.js-core/LICENSE', 'LICENSE-tesseract.js-core.txt'],
  ['tesseract.js-core/tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  // Модели «best_int» (LSTM, целочисленные): точность близка к «best» при меньшем размере.
  ['@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz', 'lang/rus.traineddata.gz'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz']
]

await rm(target, { recursive: true, force: true })
await mkdir(join(target, 'lang'), { recursive: true })
for (const [from, to] of files) {
  await copyFile(join(modules, from), join(target, to))
}
console.log(`OCR assets copied to ${target}`)
