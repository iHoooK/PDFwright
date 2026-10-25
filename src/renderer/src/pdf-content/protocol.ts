import type {
  eraseRegions,
  listPageObjects,
  moveImage,
  removeImage,
  removeTextLine,
  replaceImage,
  replaceText
} from '@shared/pdf-content/engine'

/** Операции движка pdf-content, доступные через worker. */
export interface ContentApi {
  listPageObjects: typeof listPageObjects
  eraseRegions: typeof eraseRegions
  replaceText: typeof replaceText
  removeTextLine: typeof removeTextLine
  removeImage: typeof removeImage
  replaceImage: typeof replaceImage
  moveImage: typeof moveImage
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
