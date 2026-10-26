import type {
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
} from '@shared/pdf-content/engine'
import type { extractText } from '@shared/pdf-content/extract-text'
import type { compressPdf } from '@shared/pdf-content/compress'
import type {
  inspectProtection,
  protectPdf,
  relockPdf,
  unlockPdf
} from '@shared/pdf-content/protect'

/** Операции движка pdf-content, доступные через worker. */
export interface ContentApi {
  listPageObjects: typeof listPageObjects
  eraseRegions: typeof eraseRegions
  replaceText: typeof replaceText
  removeTextLine: typeof removeTextLine
  removeImage: typeof removeImage
  replaceImage: typeof replaceImage
  moveImage: typeof moveImage
  replaceBlock: typeof replaceBlock
  insertText: typeof insertText
  removeGraphic: typeof removeGraphic
  moveGraphic: typeof moveGraphic
  extractText: typeof extractText
  compressPdf: typeof compressPdf
  // Защита паролем
  protectPdf: typeof protectPdf
  unlockPdf: typeof unlockPdf
  relockPdf: typeof relockPdf
  inspectProtection: typeof inspectProtection
}

export type ContentMethod = keyof ContentApi

export interface ContentRequest<M extends ContentMethod = ContentMethod> {
  id: number
  method: M
  args: Parameters<ContentApi[M]>
}

export interface ContentFailure {
  name: string
  message: string
}

export type ContentResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: ContentFailure }
