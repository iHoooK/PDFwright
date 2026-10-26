/**
 * Правка существующего содержимого страниц PDF на MuPDF.js (WASM): строки
 * текста и картинки страницы, вырезание областей, замена текста, удаление,
 * замена и перенос картинок. Работает в Node (тесты) и в Web Worker renderer.
 */
export {
  eraseRegions,
  insertText,
  listPageObjects,
  moveGraphic,
  moveImage,
  removeGraphic,
  removeImage,
  removeTextLine,
  replaceBlock,
  replaceImage,
  replaceText
} from './engine'
export { loadMupdf } from './mupdf'
export { extractText, linesToText, type TextLineBox } from './extract-text'
export {
  compressPdf,
  COMPRESS_PRESETS,
  type CompressLevel,
  type CompressPreset,
  type CompressResult
} from './compress'
export * from './types'
