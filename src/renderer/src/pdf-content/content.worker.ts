import {
  compressPdf,
  eraseRegions,
  insertText,
  extractText,
  listPageObjects,
  moveGraphic,
  moveImage,
  removeGraphic,
  removeImage,
  removeTextLine,
  replaceBlock,
  replaceImage,
  replaceText
} from '@shared/pdf-content'
import { inspectProtection, protectPdf, relockPdf, unlockPdf } from '@shared/pdf-content/protect'
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
  moveImage,
  replaceBlock,
  insertText,
  removeGraphic,
  moveGraphic,
  extractText,
  compressPdf,
  // Защита паролем
  protectPdf,
  unlockPdf,
  relockPdf,
  inspectProtection
}

/** Байты результата (сами или поле bytes, как у сжатия) передаются без копирования. */
function transferOf(result: unknown): Transferable[] {
  if (result instanceof Uint8Array) return [result.buffer as ArrayBuffer]
  if (typeof result === 'object' && result !== null && 'bytes' in result) {
    const { bytes } = result
    if (bytes instanceof Uint8Array) return [bytes.buffer]
  }
  return []
}

async function run(request: ContentRequest): Promise<unknown> {
  const method = api[request.method] as (...args: readonly unknown[]) => Promise<unknown>
  return method(...request.args)
}

scope.onmessage = (event) => {
  const { id } = event.data
  run(event.data).then(
    (result) => {
      const transfer = transferOf(result)
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
