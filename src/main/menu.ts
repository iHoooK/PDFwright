import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { APP_COMMAND_CHANNEL, type AppCommand } from '@shared/ipc-contract'

/**
 * Меню приложения. Оно скрыто (autoHideMenuBar), но задаёт системные
 * ускорители и открывается по Alt. Каждый пункт шлёт команду в renderer,
 * где она обрабатывается тем же кодом, что и горячие клавиши интерфейса.
 */
export interface MenuHandlers {
  /** «Файл → Новое окно»: окно создаёт main, renderer в этом не участвует. */
  newWindow: () => void
}

export function installApplicationMenu({ newWindow }: MenuHandlers): void {
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
      label: 'Файл',
      submenu: [
        { id: 'window.new', label: 'Новое окно', accelerator: 'CmdOrCtrl+N', click: newWindow },
        item('Открыть…', 'file.open', 'CmdOrCtrl+O'),
        item('Сохранить', 'file.save', 'CmdOrCtrl+S'),
        item('Сохранить как…', 'file.saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        item('Печать…', 'file.print', 'CmdOrCtrl+P'),
        item('Свойства документа', 'file.properties'),
        { type: 'separator' },
        item('Закрыть документ', 'file.close', 'CmdOrCtrl+W'),
        { type: 'separator' },
        { label: 'Выход', role: 'quit' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        // Без ускорителей: Ctrl+Z/Y обрабатывает renderer, чтобы в полях ввода
        // работала обычная отмена текста, а в документе — отмена операций.
        item('Отменить', 'edit.undo'),
        item('Повторить', 'edit.redo'),
        { type: 'separator' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Выделить всё', role: 'selectAll' },
        { type: 'separator' },
        item('Найти…', 'edit.find', 'CmdOrCtrl+F')
      ]
    },
    {
      label: 'Инструменты',
      submenu: [
        item('Объединить файлы…', 'tools.merge'),
        item('Разделить документ…', 'tools.split'),
        { type: 'separator' },
        item('Режим «Страницы»', 'view.pages', 'CmdOrCtrl+G')
      ]
    },
    {
      label: 'Вид',
      submenu: [
        item('Увеличить', 'view.zoomIn', 'CmdOrCtrl+='),
        item('Уменьшить', 'view.zoomOut', 'CmdOrCtrl+-'),
        item('Масштаб 100%', 'view.zoomReset', 'CmdOrCtrl+0'),
        item('По ширине', 'view.fitWidth', 'CmdOrCtrl+1'),
        item('Страница целиком', 'view.fitPage', 'CmdOrCtrl+2'),
        item('Повернуть вид', 'view.rotate', 'CmdOrCtrl+R'),
        { type: 'separator' },
        item('Боковая панель', 'view.sidebar', 'CmdOrCtrl+B'),
        item('Панель свойств', 'view.props', 'CmdOrCtrl+Shift+B'),
        item('Переключить тему', 'view.theme'),
        { type: 'separator' },
        item('Начало', 'app.start'),
        item('Параметры', 'app.settings', 'CmdOrCtrl+,'),
        { type: 'separator' },
        { label: 'Полный экран', role: 'togglefullscreen' },
        ...(app.isPackaged
          ? []
          : [{ label: 'Инструменты разработчика', role: 'toggleDevTools' } as const])
      ]
    },
    {
      label: 'Справка',
      submenu: [item('Страница релизов', 'help.releases'), item('О программе', 'help.about')]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
