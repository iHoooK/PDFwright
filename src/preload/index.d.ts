import type { PdfwrightApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    pdfwright: PdfwrightApi
  }
}

export {}
