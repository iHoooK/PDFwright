import { m, messageLanguage } from '@shared/messages'
import { PdfContentError } from '@shared/pdf-content/types'
import type { ContentApi, ContentFailure, ContentMethod, ContentResponse } from './protocol'

/**
 * Клиент worker'а pdf-content: запрос–ответ поверх postMessage. Worker
 * создаётся при первом вызове. Входные байты копируются и передаются в worker
 * без второго копирования, поэтому буферы вызывающего кода остаются целыми
 * (их держит история отмены). Ошибки движка приходят как PdfContentError.
 */

type Result<M extends ContentMethod> = Awaited<ReturnType<ContentApi[M]>>

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

function toError(failure: ContentFailure): Error {
  if (failure.name === 'PdfContentError') return new PdfContentError(failure.message)
  const error = new Error(failure.message)
  error.name = failure.name
  return error
}

export class PdfContentClient {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./content.worker.ts', import.meta.url), {
      type: 'module',
      // Язык сообщений движка worker узнаёт по своему имени.
      name: `pdf-content:${messageLanguage()}`
    })
    worker.onmessage = (event: MessageEvent<ContentResponse>) => {
      const response = event.data
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if (response.ok) pending.resolve(response.result)
      else pending.reject(toError(response.error))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      this.fail(new Error(`Движок правки содержимого остановился: ${event.message}`))
    }
    this.worker = worker
    return worker
  }

  private fail(error: Error): void {
    this.worker?.terminate()
    this.worker = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  call<M extends ContentMethod>(method: M, ...args: Parameters<ContentApi[M]>): Promise<Result<M>> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    const transfer: Transferable[] = []
    const copied = args.map((arg: unknown) => {
      if (!(arg instanceof Uint8Array)) return arg
      const copy = arg.slice()
      transfer.push(copy.buffer)
      return copy
    })
    return new Promise<Result<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      worker.postMessage({ id, method, args: copied }, transfer)
    })
  }

  listPageObjects(...args: Parameters<ContentApi['listPageObjects']>) {
    return this.call('listPageObjects', ...args)
  }

  eraseRegions(...args: Parameters<ContentApi['eraseRegions']>) {
    return this.call('eraseRegions', ...args)
  }

  replaceText(...args: Parameters<ContentApi['replaceText']>) {
    return this.call('replaceText', ...args)
  }

  removeTextLine(...args: Parameters<ContentApi['removeTextLine']>) {
    return this.call('removeTextLine', ...args)
  }

  removeImage(...args: Parameters<ContentApi['removeImage']>) {
    return this.call('removeImage', ...args)
  }

  replaceImage(...args: Parameters<ContentApi['replaceImage']>) {
    return this.call('replaceImage', ...args)
  }

  moveImage(...args: Parameters<ContentApi['moveImage']>) {
    return this.call('moveImage', ...args)
  }

  replaceBlock(...args: Parameters<ContentApi['replaceBlock']>) {
    return this.call('replaceBlock', ...args)
  }

  insertText(...args: Parameters<ContentApi['insertText']>) {
    return this.call('insertText', ...args)
  }

  removeGraphic(...args: Parameters<ContentApi['removeGraphic']>) {
    return this.call('removeGraphic', ...args)
  }

  moveGraphic(...args: Parameters<ContentApi['moveGraphic']>) {
    return this.call('moveGraphic', ...args)
  }

  /** Текст страниц (номера с 0) в видимом порядке строк, по строке на страницу. */
  extractText(...args: Parameters<ContentApi['extractText']>) {
    return this.call('extractText', ...args)
  }

  /** Пересжатие картинок и пересохранение со сжатием потоков. */
  compressPdf(...args: Parameters<ContentApi['compressPdf']>) {
    return this.call('compressPdf', ...args)
  }

  // Защита паролем
  /** Шифрует документ AES-256 паролем на открытие и (по желанию) паролем владельца. */
  protectPdf(...args: Parameters<ContentApi['protectPdf']>) {
    return this.call('protectPdf', ...args)
  }

  /** Расшифровывает документ паролем; у незашифрованного возвращает байты и info: null. */
  unlockPdf(...args: Parameters<ContentApi['unlockPdf']>) {
    return this.call('unlockPdf', ...args)
  }

  /** Записывает правленую расшифрованную копию с исходным шифрованием документа. */
  relockPdf(...args: Parameters<ContentApi['relockPdf']>) {
    return this.call('relockPdf', ...args)
  }

  /** Какие права даёт пароль и какие ограничения у документа. */
  inspectProtection(...args: Parameters<ContentApi['inspectProtection']>) {
    return this.call('inspectProtection', ...args)
  }

  // Аннотации документа

  /** Аннотации страницы (номер с 0), которые можно выбрать в «Выделении». */
  listAnnotations(...args: Parameters<ContentApi['listAnnotations']>) {
    return this.call('listAnnotations', ...args)
  }

  /** Перенос, размер, цвет и текст нескольких аннотаций одним сохранением. */
  editAnnotations(...args: Parameters<ContentApi['editAnnotations']>) {
    return this.call('editAnnotations', ...args)
  }

  removeAnnotations(...args: Parameters<ContentApi['removeAnnotations']>) {
    return this.call('removeAnnotations', ...args)
  }

  /** Останавливает worker; незавершённые вызовы получают ошибку. */
  dispose(): void {
    this.fail(
      new Error(
        m({ ru: 'Движок правки содержимого закрыт.', en: 'The content editing engine is closed.' })
      )
    )
  }
}

/** Общий клиент программы: один worker и один экземпляр WASM на окно. */
export const pdfContent = new PdfContentClient()
