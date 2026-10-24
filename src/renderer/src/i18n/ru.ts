/**
 * Строки интерфейса (русский). Ключи — путь «экран.элемент».
 * English появится в 0.2.0 тем же набором ключей; до тех пор `t()` читает отсюда.
 * Неразрывные пробелы после коротких предлогов стоят прямо в строках (U+00A0).
 */
export const ru = {
  app: {
    name: 'PDFwright',
    startTab: 'Начало',
    openFile: 'Открыть файл',
    settings: 'Параметры',
    toggleTheme: 'Переключить тему',
    closeTab: 'Закрыть вкладку'
  },
  start: {
    title: 'Добро пожаловать в\u00a0PDFwright',
    lead: 'Документы обрабатываются на\u00a0этом компьютере и\u00a0никуда не\u00a0отправляются.',
    open: 'Открыть PDF',
    openHint:
      'Выбрать файл или перетащить его в\u00a0окно. Двойной клик в\u00a0Проводнике тоже откроет документ здесь.',
    merge: 'Объединить',
    mergeHint: 'Несколько файлов в\u00a0один',
    split: 'Разделить',
    splitHint: 'По\u00a0диапазонам или на\u00a0страницы',
    images: 'Из\u00a0изображений',
    imagesHint: 'JPG, PNG, WebP в\u00a0PDF',
    recent: 'Недавние',
    recentEmpty: 'Нет недавних файлов. Откройте PDF или перетащите его в\u00a0окно.',
    removeRecent: 'Убрать из\u00a0списка',
    pages: 'стр.',
    soon: 'Появится в\u00a0следующих версиях'
  },
  cmd: {
    save: 'Сохранить',
    print: 'Печать',
    undo: 'Отменить',
    redo: 'Повторить',
    select: 'Выделение',
    hand: 'Рука',
    marker: 'Маркер',
    pen: 'Перо',
    shapes: 'Фигуры',
    text: 'Текст',
    sign: 'Подпись',
    pages: 'Страницы',
    rotate: 'Повернуть',
    zoomIn: 'Увеличить',
    zoomOut: 'Уменьшить',
    search: 'Поиск в\u00a0документе',
    sidebar: 'Боковая панель',
    props: 'Свойства',
    zoomMenu: 'Режим масштаба',
    fitWidth: 'По\u00a0ширине',
    fitPage: 'Страница целиком',
    zoomActual: 'Масштаб 100%'
  },
  sidebar: {
    thumbs: 'Страницы',
    outline: 'Закладки',
    search: 'Поиск',
    outlineEmpty: 'В\u00a0документе нет закладок.',
    outlineBroken: 'Закладка ведёт в\u00a0никуда.',
    searchEmpty: 'Введите текст и\u00a0нажмите Enter. Shift+Enter — предыдущее совпадение.'
  },
  viewer: {
    emptyTitle: 'Документ ещё не\u00a0открыт',
    emptyLead:
      'Откройте PDF через кнопку «+» на\u00a0панели вкладок или перетащите файл в\u00a0окно.',
    loading: 'Открываем документ…',
    errorTitle: 'Не\u00a0удалось открыть документ',
    retry: 'Повторить',
    closeTab: 'Закрыть вкладку',
    printFailed: 'Печать не\u00a0выполнена',
    pageOf: (n: number, total: number) => `Страница ${n} из\u00a0${total}`,
    pageShort: (n: number, total: number) => `${n} / ${total}`,
    paperA4: 'A4 · 210 × 297 мм',
    saved: 'Сохранено',
    unsaved: 'Есть несохранённые изменения',
    searchHint: 'поиск'
  },
  pages: {
    selected: (n: number) => (n ? `Выбрано: ${n}` : 'Выберите страницы'),
    rotate: 'Повернуть',
    extract: 'Извлечь',
    insert: 'Вставить',
    remove: 'Удалить'
  },
  props: {
    color: 'Цвет',
    opacity: 'Непрозрачность',
    saveAs: 'Сохранять как',
    asAnnotation: 'Аннотацию',
    asContent: 'Часть содержимого страницы',
    saveNote: 'Аннотацию можно удалить в\u00a0любой программе. Содержимое страницы — нельзя.',
    document: 'Документ',
    modified: 'Изменён',
    properties: 'Свойства документа',
    annotationsSoon:
      'Инструменты разметки появятся в\u00a0версии 0.2.0. Сейчас работают просмотр, выделение и\u00a0копирование текста.'
  },
  settings: {
    title: 'Параметры',
    back: 'Назад к\u00a0документу',
    general: 'Общие',
    generalLead: 'Тема, язык и\u00a0поведение при сохранении.',
    theme: 'Тема приложения',
    themeHint: 'Как в\u00a0системе, светлая или тёмная',
    themeSystem: 'Как в\u00a0системе',
    themeLight: 'Светлая',
    themeDark: 'Тёмная',
    language: 'Язык интерфейса',
    languageHint: 'English появится в\u00a00.2.0',
    languageRu: 'Русский',
    backup: 'Резервная копия при сохранении',
    backupHint: 'Рядом с\u00a0файлом создаётся копия .bak',
    view: 'Просмотр',
    viewLead: 'Как открываются документы.',
    zoom: 'Масштаб по\u00a0умолчанию',
    zoomFitWidth: 'По\u00a0ширине',
    zoomFitPage: 'Страница целиком',
    zoomActual: '100%',
    scroll: 'Режим прокрутки',
    scrollContinuous: 'Непрерывно',
    scrollSingle: 'По\u00a0одной',
    scrollSpread: 'Разворот',
    updates: 'Обновления',
    updatesLead:
      'Проверка выполняется только по\u00a0кнопке. Программа обращается к\u00a0GitHub; документы и\u00a0настройки не\u00a0передаются.',
    installed: (v: string) => `Установлена версия ${v}`,
    updatesHint: 'Нажмите «Проверить обновления», чтобы узнать о\u00a0новой версии.',
    updatesSoon: 'Проверка обновлений появится в\u00a0фазе 8.',
    check: 'Проверить обновления',
    releases: 'Страница релизов',
    about: 'О\u00a0программе',
    aboutLead: (v: string, kind: string) => `PDFwright ${v} · Windows x64 · ${kind}`,
    kindInstalled: 'установленная версия',
    kindPortable: 'portable-версия',
    kindDev: 'режима разработки',
    aboutText:
      'Локальная программа для просмотра и\u00a0редактирования PDF. Код открыт под лицензией MIT.',
    copyDiag: 'Скопировать диагностику',
    copied: 'Диагностика скопирована',
    licenses: 'Лицензии компонентов',
    author: 'О\u00a0разработчике',
    authorLead: 'Автор и\u00a0его каналы.',
    authorText:
      'Я Андрей, автор Promptix. Делаю небольшие локальные инструменты для Windows и\u00a0показываю на\u00a0YouTube, как они создаются.',
    on: 'Вкл.',
    off: 'Выкл.',
    hotkeys: 'Горячие клавиши'
  },
  password: {
    title: 'Документ защищён паролем',
    lead: (name: string) => `Введите пароль, чтобы открыть «${name}».`,
    wrong: 'Неверный пароль. Попробуйте ещё раз.',
    open: 'Открыть',
    cancel: 'Отмена'
  },
  properties: {
    title_: 'Свойства документа',
    close: 'Закрыть',
    file: 'Файл',
    path: 'Расположение',
    size: 'Размер файла',
    pages: 'Страниц',
    pageSize: 'Размер страницы',
    title: 'Заголовок',
    author: 'Автор',
    subject: 'Тема',
    keywords: 'Ключевые слова',
    creator: 'Создано в',
    producer: 'Обработано',
    created: 'Дата создания',
    modified: 'Дата изменения',
    version: 'Версия PDF',
    encrypted: 'Шифрование',
    yes: 'Да',
    no: 'Нет'
  },
  search: {
    running: 'Ищем…',
    none: (q: string) => `Ничего не найдено: «${q}»`,
    found: (n: number, current: number) => `${current} из ${n}`,
    prev: 'Предыдущее совпадение',
    next: 'Следующее совпадение',
    page: (n: number) => `стр. ${n}`
  },
  toast: {
    soon: 'Появится в\u00a0следующих версиях',
    linkBlocked: 'Открытие этого адреса не\u00a0разрешено',
    dropFailed: 'Не\u00a0удалось определить путь к\u00a0файлу'
  }
} as const

export type Strings = typeof ru
