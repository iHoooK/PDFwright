import { m } from '../messages'
import type { PDFDocument as MuDocument } from 'mupdf'
import type { Mupdf } from './mupdf'
import { PdfContentError } from './types'

/** Открывает PDF в MuPDF для чтения или пересохранения; зашифрованные файлы не принимаются. */
export function openPdf(mupdf: Mupdf, bytes: Uint8Array, encryptedMessage: string): MuDocument {
  let doc: MuDocument
  try {
    doc = new mupdf.PDFDocument(bytes)
  } catch (error) {
    throw new PdfContentError(
      m({
        ru: `Не удалось разобрать PDF: ${error instanceof Error ? error.message : String(error)}`,
        en: `Could not parse the PDF: ${error instanceof Error ? error.message : String(error)}`
      })
    )
  }
  if (doc.needsPassword()) {
    doc.destroy()
    throw new PdfContentError(encryptedMessage)
  }
  return doc
}
