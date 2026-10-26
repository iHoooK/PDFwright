import { m } from '../messages'
import { PDFDocument } from 'pdf-lib'

/** Загрузка и сохранение документа pdf-lib — общие для всех операций. */

export const PRODUCER = 'PDFwright'

export class PdfOpsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfOpsError'
  }
}

export async function load(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  } catch (error) {
    throw new PdfOpsError(
      m({
        ru: `Не удалось разобрать PDF: ${error instanceof Error ? error.message : String(error)}`,
        en: `Could not parse the PDF: ${error instanceof Error ? error.message : String(error)}`
      })
    )
  }
  if (doc.isEncrypted) {
    throw new PdfOpsError(
      m({
        ru: 'Документ зашифрован. Правка защищённых паролем файлов появится в следующих версиях.',
        en: 'The document is encrypted. Editing password-protected files will come in a future version.'
      })
    )
  }
  return doc
}

export async function save(doc: PDFDocument): Promise<Uint8Array> {
  doc.setProducer(PRODUCER)
  doc.setModificationDate(new Date())
  return doc.save({ useObjectStreams: true, addDefaultPage: false })
}
