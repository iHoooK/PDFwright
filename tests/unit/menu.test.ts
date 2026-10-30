import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { APP_COMMAND_CHANNEL } from '@shared/ipc-contract'
import { installApplicationMenu } from '../../src/main/menu'
import { mainStrings } from '../../src/main/strings'

/**
 * Шаблон меню собирается без Electron: модуль подменён, а команды пунктов
 * узнаются по тому, что пункт отправляет в окно при щелчке.
 */
const electron = vi.hoisted(() => {
  const sent: unknown[] = []
  const window = {
    webContents: {
      send: (channel: string, command: unknown) => {
        sent.push([channel, command])
      }
    }
  }
  return {
    sent,
    app: { isPackaged: false, name: 'PDFwright' },
    BrowserWindow: { getFocusedWindow: () => window, getAllWindows: () => [window] },
    Menu: {
      buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => template),
      setApplicationMenu: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  Menu: electron.Menu
}))

interface ItemView {
  label?: string
  accelerator?: string
  role?: string
  id?: string
  /** Команда, которую пункт шлёт в renderer, или 'newWindow' для обработчика main. */
  command?: string
  submenu?: (ItemView | '---')[]
}

function view(items: MenuItemConstructorOptions[]): (ItemView | '---')[] {
  return items.map((item) => {
    if (item.type === 'separator') return '---'
    const result: ItemView = {}
    if (item.label !== undefined) result.label = item.label
    if (item.accelerator !== undefined) result.accelerator = item.accelerator
    if (item.role !== undefined) result.role = item.role
    if (item.id !== undefined) result.id = item.id
    if (item.click) {
      electron.sent.length = 0
      ;(item.click as () => void)()
      const [channel, command] = (electron.sent[0] ?? []) as [string?, string?]
      result.command = channel === APP_COMMAND_CHANNEL ? String(command) : 'newWindow'
    }
    if (Array.isArray(item.submenu)) result.submenu = view(item.submenu)
    return result
  })
}

function installedTemplate(): MenuItemConstructorOptions[] {
  const calls = electron.Menu.buildFromTemplate.mock.calls
  const template = calls[calls.length - 1]?.[0]
  if (!template) throw new Error('меню не собрано')
  return template
}

const realPlatform = process.platform
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('меню приложения в Windows', () => {
  beforeEach(() => {
    setPlatform('win32')
    electron.app.isPackaged = false
    electron.Menu.buildFromTemplate.mockClear()
    electron.Menu.setApplicationMenu.mockClear()
  })
  afterEach(() => {
    setPlatform(realPlatform)
  })

  it('совпадает с шаблоном версии 1.0.0: подписи, ускорители, роли и порядок', () => {
    installApplicationMenu({ newWindow: () => undefined, strings: mainStrings('ru') })
    expect(view(installedTemplate())).toEqual([
      {
        label: 'Файл',
        submenu: [
          {
            label: 'Новое окно',
            accelerator: 'CmdOrCtrl+N',
            id: 'window.new',
            command: 'newWindow'
          },
          { label: 'Открыть…', accelerator: 'CmdOrCtrl+O', command: 'file.open' },
          { label: 'Сохранить', accelerator: 'CmdOrCtrl+S', command: 'file.save' },
          { label: 'Сохранить как…', accelerator: 'CmdOrCtrl+Shift+S', command: 'file.saveAs' },
          '---',
          { label: 'Печать…', accelerator: 'CmdOrCtrl+P', command: 'file.print' },
          { label: 'Свойства документа', command: 'file.properties' },
          { label: 'Защита паролем…', id: 'file.protect', command: 'file.protect' },
          '---',
          { label: 'Закрыть документ', accelerator: 'CmdOrCtrl+W', command: 'file.close' },
          '---',
          { label: 'Выход', role: 'quit' }
        ]
      },
      {
        label: 'Правка',
        submenu: [
          { label: 'Отменить', command: 'edit.undo' },
          { label: 'Повторить', command: 'edit.redo' },
          '---',
          { label: 'Копировать', role: 'copy' },
          { label: 'Выделить всё', role: 'selectAll' },
          '---',
          { label: 'Найти…', accelerator: 'CmdOrCtrl+F', command: 'edit.find' }
        ]
      },
      {
        label: 'Инструменты',
        submenu: [
          { label: 'Объединить файлы…', command: 'tools.merge' },
          { label: 'Разделить документ…', command: 'tools.split' },
          { label: 'Сравнить с…', command: 'tools.compare' },
          '---',
          { label: 'Режим «Страницы»', accelerator: 'CmdOrCtrl+G', command: 'view.pages' },
          '---',
          { label: 'PDF в изображения…', command: 'tools.toImages' },
          { label: 'Изображения в PDF…', command: 'tools.fromImages' },
          { label: 'Извлечь текст…', command: 'tools.extractText' },
          { label: 'Распознать текст…', command: 'tools.ocr' },
          { label: 'Сжать PDF…', command: 'tools.compress' }
        ]
      },
      {
        label: 'Вид',
        submenu: [
          { label: 'Увеличить', accelerator: 'CmdOrCtrl+=', command: 'view.zoomIn' },
          { label: 'Уменьшить', accelerator: 'CmdOrCtrl+-', command: 'view.zoomOut' },
          { label: 'Масштаб 100%', accelerator: 'CmdOrCtrl+0', command: 'view.zoomReset' },
          { label: 'По ширине', accelerator: 'CmdOrCtrl+1', command: 'view.fitWidth' },
          { label: 'Страница целиком', accelerator: 'CmdOrCtrl+2', command: 'view.fitPage' },
          { label: 'Повернуть вид', accelerator: 'CmdOrCtrl+R', command: 'view.rotate' },
          '---',
          { label: 'Боковая панель', accelerator: 'CmdOrCtrl+B', command: 'view.sidebar' },
          { label: 'Панель свойств', accelerator: 'CmdOrCtrl+Shift+B', command: 'view.props' },
          { label: 'Переключить тему', command: 'view.theme' },
          '---',
          { label: 'Начало', command: 'app.start' },
          { label: 'Параметры', accelerator: 'CmdOrCtrl+,', command: 'app.settings' },
          '---',
          { label: 'Полный экран', role: 'togglefullscreen' },
          { label: 'Инструменты разработчика', role: 'toggleDevTools' }
        ]
      },
      {
        label: 'Справка',
        submenu: [
          { label: 'Страница релизов', command: 'help.releases' },
          { label: 'О программе', command: 'help.about' }
        ]
      }
    ])
    expect(electron.Menu.setApplicationMenu).toHaveBeenCalledWith(installedTemplate())
  })

  it('в собранной программе нет инструментов разработчика', () => {
    electron.app.isPackaged = true
    installApplicationMenu({ newWindow: () => undefined, strings: mainStrings('ru') })
    const viewMenu = view(installedTemplate())[3]
    expect(viewMenu !== '---' && viewMenu?.submenu?.at(-1)).toEqual({
      label: 'Полный экран',
      role: 'togglefullscreen'
    })
  })

  it('по-английски — те же пункты с английскими подписями', () => {
    installApplicationMenu({ newWindow: () => undefined, strings: mainStrings('en') })
    const english = view(installedTemplate())
    installApplicationMenu({ newWindow: () => undefined, strings: mainStrings('ru') })
    const russian = view(installedTemplate())
    const shape = (items: (ItemView | '---')[]): unknown =>
      items.map((item) =>
        item === '---'
          ? item
          : { ...item, label: undefined, submenu: item.submenu && shape(item.submenu) }
      )
    expect(shape(english)).toEqual(shape(russian))
    expect(english.map((item) => item !== '---' && item.label)).toEqual([
      'File',
      'Edit',
      'Tools',
      'View',
      'Help'
    ])
  })
})

describe('меню приложения на Mac', () => {
  beforeEach(() => {
    setPlatform('darwin')
    electron.app.isPackaged = true
    electron.Menu.buildFromTemplate.mockClear()
  })
  afterEach(() => {
    setPlatform(realPlatform)
  })

  function macMenu(): (ItemView | '---')[] {
    installApplicationMenu({ newWindow: () => undefined, strings: mainStrings('ru') })
    return view(installedTemplate())
  }
  function submenu(label: string): (ItemView | '---')[] {
    const found = macMenu().find((item) => item !== '---' && item.label === label)
    if (!found || found === '---' || !found.submenu) throw new Error(`нет меню ${label}`)
    return found.submenu
  }

  it('первое — меню программы: о программе, параметры, службы, скрыть и завершить', () => {
    expect(macMenu()[0]).toEqual({
      label: 'PDFwright',
      submenu: [
        { label: 'О программе PDFwright', command: 'help.about' },
        '---',
        { label: 'Параметры…', accelerator: 'Cmd+,', command: 'app.settings' },
        '---',
        { label: 'Службы', role: 'services', submenu: [] },
        '---',
        { label: 'Скрыть PDFwright', role: 'hide' },
        { label: 'Скрыть остальные', role: 'hideOthers' },
        { label: 'Показать все', role: 'unhide' },
        '---',
        { label: 'Завершить PDFwright', role: 'quit' }
      ]
    })
  })

  it('меню по порядку: программа, Файл, Правка, Инструменты, Вид, Окно, Справка', () => {
    expect(macMenu().map((item) => item !== '---' && item.label)).toEqual([
      'PDFwright',
      'Файл',
      'Правка',
      'Инструменты',
      'Вид',
      'Окно',
      'Справка'
    ])
  })

  it('«Правка»: отмена шлёт команду в renderer, правка текста — системными ролями', () => {
    expect(submenu('Правка')).toEqual([
      { label: 'Отменить', accelerator: 'Cmd+Z', id: 'edit.undo', command: 'edit.undo' },
      { label: 'Повторить', accelerator: 'Shift+Cmd+Z', id: 'edit.redo', command: 'edit.redo' },
      '---',
      { label: 'Вырезать', role: 'cut' },
      { label: 'Копировать', role: 'copy' },
      { label: 'Вставить', role: 'paste' },
      { label: 'Выделить всё', role: 'selectAll' },
      '---',
      { label: 'Найти…', accelerator: 'Cmd+F', command: 'edit.find' }
    ])
  })

  it('«Окно»: свернуть, масштаб и все окна вперёд; список окон добавляет macOS', () => {
    const menu = macMenu().find((item) => item !== '---' && item.label === 'Окно')
    expect(menu).toEqual({
      label: 'Окно',
      role: 'window',
      submenu: [
        { label: 'Свернуть', role: 'minimize' },
        { label: 'Изменить масштаб', role: 'zoom' },
        '---',
        { label: 'Все окна — на передний план', role: 'front' }
      ]
    })
  })

  it('выход и параметры не повторяются в «Файле» и «Виде», «О программе» — не в «Справке»', () => {
    const file = submenu('Файл')
    expect(file.at(-1)).toEqual({
      label: 'Закрыть документ',
      accelerator: 'CmdOrCtrl+W',
      command: 'file.close'
    })
    const commands = (items: (ItemView | '---')[]): (string | undefined)[] =>
      items.map((item) => (item === '---' ? item : (item.command ?? item.role)))
    expect(commands(file)).not.toContain('quit')
    expect(commands(submenu('Вид'))).not.toContain('app.settings')
    expect(submenu('Справка')).toEqual([{ label: 'Страница релизов', command: 'help.releases' }])
    expect(macMenu().find((item) => item !== '---' && item.label === 'Справка')).toMatchObject({
      role: 'help'
    })
  })

  it('по-английски меню программы и «Окно» с английскими подписями', () => {
    installApplicationMenu({ newWindow: () => undefined, strings: mainStrings('en') })
    const english = view(installedTemplate())
    expect(english.map((item) => item !== '---' && item.label)).toEqual([
      'PDFwright',
      'File',
      'Edit',
      'Tools',
      'View',
      'Window',
      'Help'
    ])
    const appMenu = english[0]
    expect(appMenu !== '---' && appMenu?.submenu?.at(-1)).toEqual({
      label: 'Quit PDFwright',
      role: 'quit'
    })
  })
})
