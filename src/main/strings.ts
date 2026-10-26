import type { Language } from '@shared/settings-schema'

/**
 * Строки процесса main: меню, системные диалоги, подтверждение закрытия.
 * Язык — из настроек (general.language); при его смене меню собирается заново.
 */
const ru = {
  menu: {
    file: 'Файл',
    newWindow: 'Новое окно',
    open: 'Открыть…',
    save: 'Сохранить',
    saveAs: 'Сохранить как…',
    print: 'Печать…',
    properties: 'Свойства документа',
    close: 'Закрыть документ',
    quit: 'Выход',
    edit: 'Правка',
    undo: 'Отменить',
    redo: 'Повторить',
    copy: 'Копировать',
    selectAll: 'Выделить всё',
    find: 'Найти…',
    tools: 'Инструменты',
    merge: 'Объединить файлы…',
    split: 'Разделить документ…',
    compare: 'Сравнить с…',
    pages: 'Режим «Страницы»',
    toImages: 'PDF в изображения…',
    fromImages: 'Изображения в PDF…',
    extractText: 'Извлечь текст…',
    compress: 'Сжать PDF…',
    view: 'Вид',
    zoomIn: 'Увеличить',
    zoomOut: 'Уменьшить',
    zoomReset: 'Масштаб 100%',
    fitWidth: 'По ширине',
    fitPage: 'Страница целиком',
    rotate: 'Повернуть вид',
    sidebar: 'Боковая панель',
    props: 'Панель свойств',
    theme: 'Переключить тему',
    start: 'Начало',
    settings: 'Параметры',
    fullscreen: 'Полный экран',
    devTools: 'Инструменты разработчика',
    help: 'Справка',
    releases: 'Страница релизов',
    about: 'О программе'
  },
  dialogs: {
    openPdf: 'Открыть PDF',
    openPdfs: 'Выберите PDF-файлы',
    savePdf: 'Сохранить PDF',
    chooseFolder: 'Папка для сохранения',
    chooseImages: 'Выберите картинки',
    saveText: 'Сохранить текст',
    pdfFiles: 'Документы PDF',
    images: 'Картинки',
    text: 'Текст',
    allFiles: 'Все файлы'
  },
  close: {
    oneDirty: 'В документе есть несохранённые изменения.',
    manyDirty: (n: number) => `Несохранённые изменения в документах: ${n}.`,
    closeWindow: 'Закрыть окно без сохранения? Изменения будут потеряны.',
    quitApp: 'Закрыть программу без сохранения? Изменения будут потеряны.',
    discard: 'Закрыть без сохранения',
    cancel: 'Отмена'
  },
  printFailed: 'Печать не выполнена'
}

export type MainStrings = typeof ru

const en: MainStrings = {
  menu: {
    file: 'File',
    newWindow: 'New window',
    open: 'Open…',
    save: 'Save',
    saveAs: 'Save as…',
    print: 'Print…',
    properties: 'Document properties',
    close: 'Close document',
    quit: 'Exit',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    copy: 'Copy',
    selectAll: 'Select all',
    find: 'Find…',
    tools: 'Tools',
    merge: 'Merge files…',
    split: 'Split document…',
    compare: 'Compare with…',
    pages: 'Pages mode',
    toImages: 'PDF to images…',
    fromImages: 'Images to PDF…',
    extractText: 'Extract text…',
    compress: 'Compress PDF…',
    view: 'View',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomReset: 'Actual size (100%)',
    fitWidth: 'Fit width',
    fitPage: 'Fit page',
    rotate: 'Rotate view',
    sidebar: 'Sidebar',
    props: 'Properties pane',
    theme: 'Switch theme',
    start: 'Home',
    settings: 'Settings',
    fullscreen: 'Full screen',
    devTools: 'Developer tools',
    help: 'Help',
    releases: 'Releases page',
    about: 'About'
  },
  dialogs: {
    openPdf: 'Open PDF',
    openPdfs: 'Choose PDF files',
    savePdf: 'Save PDF',
    chooseFolder: 'Folder to save to',
    chooseImages: 'Choose images',
    saveText: 'Save text',
    pdfFiles: 'PDF documents',
    images: 'Images',
    text: 'Text',
    allFiles: 'All files'
  },
  close: {
    oneDirty: 'The document has unsaved changes.',
    manyDirty: (n: number) => `${n} documents have unsaved changes.`,
    closeWindow: 'Close the window without saving? Your changes will be lost.',
    quitApp: 'Close PDFwright without saving? Your changes will be lost.',
    discard: 'Close without saving',
    cancel: 'Cancel'
  },
  printFailed: 'Printing failed'
}

export function mainStrings(language: Language): MainStrings {
  return language === 'en' ? en : ru
}
