import {
  eraseRegions,
  listPageObjects,
  moveImage,
  removeImage,
  removeTextLine,
  replaceImage,
  replaceText
} from '@shared/pdf-content'
import type { ContentApi, ContentRequest, ContentResponse } from './protocol'

/**
 * Web Worker движка pdf-content: MuPDF (WASM) работает здесь, чтобы правка
 * больших страниц не блокировала интерфейс. WASM загружается при первой
 * операции. Байты результата передаются обратно без копирования (transferable).
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<ContentRequest>) => void) | null
  postMessage: (message: ContentResponse, transfer: Transferable[]) => void
}

const scope = self as unknown as WorkerScope

const api: ContentApi = {
  listPageObjects,
  eraseRegions,
  replaceText,
  removeTextLine,
  removeImage,
  replaceImage,
  moveImage
}

async function run(request: ContentRequest): Promise<unknown> {
  const method = api[request.method] as (...args: readonly unknown[]) => Promise<unknown>
  return method(...request.args)
}

scope.onmessage = (event) => {
  const { id } = event.data
  run(event.data).then(
    (result) => {
      const transfer = result instanceof Uint8Array ? [result.buffer as ArrayBuffer] : []
      scope.postMessage({ id, ok: true, result }, transfer)
    },
    (error: unknown) => {
      const failure =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: 'Error', message: String(error) }
      scope.postMessage({ id, ok: false, error: failure }, [])
    }
  )
}
