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
    props: 'Свойства'
  },
  sidebar: {
    thumbs: 'Страницы',
    outline: 'Закладки',
    search: 'Поиск',
    outlineEmpty: 'В\u00a0документе нет закладок.',
    searchEmpty: 'Введите текст для поиска по\u00a0документу.'
  },
  viewer: {
    emptyTitle: 'Документ ещё не\u00a0открыт',
    emptyLead:
      'Просмотр появится в\u00a0фазе 2. Сейчас это каркас экрана с\u00a0условными страницами.',
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
    modified: 'Изменён'
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
  toast: {
    soon: 'Появится в\u00a0следующих версиях',
    linkBlocked: 'Открытие этого адреса не\u00a0разрешено'
  }
} as const

export type Strings = typeof ru
