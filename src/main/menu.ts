import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { APP_COMMAND_CHANNEL, type AppCommand } from '@shared/ipc-contract'
import type { MainStrings } from './strings'

/**
 * Меню приложения. В Windows оно скрыто (autoHideMenuBar), но задаёт системные
 * ускорители и открывается по Alt. Каждый пункт шлёт команду в renderer,
 * где она обрабатывается тем же кодом, что и горячие клавиши интерфейса.
 * На Mac меню всегда видно в строке меню и дополняется меню программы,
 * правкой текста и меню «Окно».
 */
export interface MenuHandlers {
  /** «Файл → Новое окно»: окно создаёт main, renderer в этом не участвует. */
  newWindow: () => void
  /** Подписи на языке интерфейса; при смене языка меню ставится заново. */
  strings: MainStrings
}

export function installApplicationMenu({ newWindow, strings }: MenuHandlers): void {
  const s = strings.menu
  const mac = process.platform === 'darwin'
  const send = (command: AppCommand) => (): void => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    window?.webContents.send(APP_COMMAND_CHANNEL, command)
  }

  const item = (
    label: string,
    command: AppCommand,
    accelerator?: string
  ): MenuItemConstructorOptions =>
    accelerator === undefined
      ? { label, click: send(command) }
      : { label, accelerator, click: send(command) }

  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [macAppMenu(strings, send)] : []),
    {
      label: s.file,
      submenu: [
        { id: 'window.new', label: s.newWindow, accelerator: 'CmdOrCtrl+N', click: newWindow },
        item(s.open, 'file.open', 'CmdOrCtrl+O'),
        item(s.save, 'file.save', 'CmdOrCtrl+S'),
        item(s.saveAs, 'file.saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        item(s.print, 'file.print', 'CmdOrCtrl+P'),
        item(s.properties, 'file.properties'),
        { ...item(s.protect, 'file.protect'), id: 'file.protect' },
        { type: 'separator' },
        item(s.close, 'file.close', 'CmdOrCtrl+W'),
        // На Mac выход — в меню программы.
        ...(mac ? [] : [{ type: 'separator' } as const, { label: s.quit, role: 'quit' } as const])
      ]
    },
    mac
      ? macEditMenu(strings, send)
      : {
          label: s.edit,
          submenu: [
            // Без ускорителей: Ctrl+Z/Y обрабатывает renderer, чтобы в полях ввода
            // работала обычная отмена текста, а в документе — отмена операций.
            item(s.undo, 'edit.undo'),
            item(s.redo, 'edit.redo'),
            { type: 'separator' },
            { label: s.copy, role: 'copy' },
            { label: s.selectAll, role: 'selectAll' },
            { type: 'separator' },
            item(s.find, 'edit.find', 'CmdOrCtrl+F')
          ]
        },
    {
      label: s.tools,
      submenu: [
        item(s.merge, 'tools.merge'),
        item(s.split, 'tools.split'),
        item(s.compare, 'tools.compare'),
        { type: 'separator' },
        item(s.pages, 'view.pages', 'CmdOrCtrl+G'),
        { type: 'separator' },
        item(s.toImages, 'tools.toImages'),
        item(s.fromImages, 'tools.fromImages'),
        item(s.extractText, 'tools.extractText'),
        item(s.ocr, 'tools.ocr'),
        item(s.compress, 'tools.compress')
      ]
    },
    {
      label: s.view,
      submenu: [
        item(s.zoomIn, 'view.zoomIn', 'CmdOrCtrl+='),
        item(s.zoomOut, 'view.zoomOut', 'CmdOrCtrl+-'),
        item(s.zoomReset, 'view.zoomReset', 'CmdOrCtrl+0'),
        item(s.fitWidth, 'view.fitWidth', 'CmdOrCtrl+1'),
        item(s.fitPage, 'view.fitPage', 'CmdOrCtrl+2'),
        item(s.rotate, 'view.rotate', 'CmdOrCtrl+R'),
        { type: 'separator' },
        item(s.sidebar, 'view.sidebar', 'CmdOrCtrl+B'),
        item(s.props, 'view.props', 'CmdOrCtrl+Shift+B'),
        item(s.theme, 'view.theme'),
        { type: 'separator' },
        item(s.start, 'app.start'),
        // На Mac «Параметры» — в меню программы.
        ...(mac ? [] : [item(s.settings, 'app.settings', 'CmdOrCtrl+,')]),
        { type: 'separator' },
        { label: s.fullscreen, role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ label: s.devTools, role: 'toggleDevTools' } as const])
      ]
    },
    ...(mac ? [macWindowMenu(strings)] : []),
    mac
      ? // Роль help добавляет в меню системный поиск по пунктам; «О программе» — в меню программы.
        { label: s.help, role: 'help', submenu: [item(s.releases, 'help.releases')] }
      : {
          label: s.help,
          submenu: [item(s.releases, 'help.releases'), item(s.about, 'help.about')]
        }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

type Send = (command: AppCommand) => () => void

/** Меню программы на Mac: его заголовок — имя программы, macOS берёт его из пакета. */
function macAppMenu(strings: MainStrings, send: Send): MenuItemConstructorOptions {
  const m = strings.macMenu
  return {
    label: app.name,
    submenu: [
      { label: m.about, click: send('help.about') },
      { type: 'separator' },
      { label: m.settings, accelerator: 'Cmd+,', click: send('app.settings') },
      { type: 'separator' },
      { label: m.services, role: 'services', submenu: [] },
      { type: 'separator' },
      { label: m.hide, role: 'hide' },
      { label: m.hideOthers, role: 'hideOthers' },
      { label: m.showAll, role: 'unhide' },
      { type: 'separator' },
      { label: m.quit, role: 'quit' }
    ]
  }
}

/**
 * «Правка» на Mac. Здесь сочетания ⌘X, ⌘C, ⌘V, ⌘A и ⌘Z работают в полях
 * ввода только через меню: Chromium на Mac сам их не обрабатывает. Renderer
 * получает клавишу первым: ⌘Z в документе он выполняет как отмену операции
 * и до меню её не пропускает, а в поле ввода пропускает — тогда пункт меню
 * шлёт edit.undo, и renderer отменяет правку текста в поле.
 */
function macEditMenu(strings: MainStrings, send: Send): MenuItemConstructorOptions {
  const s = strings.menu
  const m = strings.macMenu
  return {
    label: s.edit,
    submenu: [
      { id: 'edit.undo', label: s.undo, accelerator: 'Cmd+Z', click: send('edit.undo') },
      { id: 'edit.redo', label: s.redo, accelerator: 'Shift+Cmd+Z', click: send('edit.redo') },
      { type: 'separator' },
      { label: m.cut, role: 'cut' },
      { label: s.copy, role: 'copy' },
      { label: m.paste, role: 'paste' },
      { label: s.selectAll, role: 'selectAll' },
      { type: 'separator' },
      { label: s.find, accelerator: 'Cmd+F', click: send('edit.find') }
    ]
  }
}

/** «Окно» на Mac: роль window добавляет в конец список открытых окон. */
function macWindowMenu(strings: MainStrings): MenuItemConstructorOptions {
  const m = strings.macMenu
  return {
    label: m.window,
    role: 'window',
    submenu: [
      { label: m.minimize, role: 'minimize' },
      { label: m.zoom, role: 'zoom' },
      { type: 'separator' },
      { label: m.front, role: 'front' }
    ]
  }
}
