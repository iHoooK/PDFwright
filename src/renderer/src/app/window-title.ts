const APP_NAME = 'PDFwright'

/**
 * Заголовок окна: «Имя.pdf — PDFwright» по документу на экране, иначе
 * «PDFwright». По нему окна различимы на панели задач и в Alt+Tab.
 */
export function windowTitle(documentName: string | null): string {
  return documentName === null || documentName === '' ? APP_NAME : `${documentName} — ${APP_NAME}`
}
