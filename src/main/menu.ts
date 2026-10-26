import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { APP_COMMAND_CHANNEL, type AppCommand } from '@shared/ipc-contract'
import type { MainStrings } from './strings'

/**
 * Меню приложения. Оно скрыто (autoHideMenuBar), но задаёт системные
 * ускорители и открывается по Alt. Каждый пункт шлёт команду в renderer,
 * где она обрабатывается тем же кодом, что и горячие клавиши интерфейса.
 */
export interface MenuHandlers {
  /** «Файл → Новое окно»: окно создаёт main, renderer в этом не участвует. */
  newWindow: () => void
  /** Подписи на языке интерфейса; при смене языка меню ставится заново. */
  strings: MainStrings
}

export function installApplicationMenu({ newWindow, strings }: MenuHandlers): void {
  const s = strings.menu
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
        { type: 'separator' },
        item(s.close, 'file.close', 'CmdOrCtrl+W'),
        { type: 'separator' },
        { label: s.quit, role: 'quit' }
      ]
    },
    {
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
        item(s.settings, 'app.settings', 'CmdOrCtrl+,'),
        { type: 'separator' },
        { label: s.fullscreen, role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ label: s.devTools, role: 'toggleDevTools' } as const])
      ]
    },
    {
      label: s.help,
      submenu: [item(s.releases, 'help.releases'), item(s.about, 'help.about')]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
