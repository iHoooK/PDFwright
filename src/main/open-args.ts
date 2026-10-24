import { isAbsolute, resolve } from 'node:path'

/**
 * Достаёт путь к PDF из аргументов запуска: двойной клик по файлу в Проводнике
 * передаёт его последним аргументом. Флаги Electron/Chromium (`--...`) и
 * служебный `.` из `electron .` игнорируются. Берётся последний аргумент
 * с расширением .pdf; относительный путь разрешается от cwd.
 */
export function extractPdfPath(argv: readonly string[], cwd: string): string | null {
  for (let i = argv.length - 1; i >= 1; i -= 1) {
    const arg = argv[i]
    if (arg === undefined || arg.startsWith('--') || arg === '.') continue
    if (!/\.pdf$/i.test(arg)) continue
    return isAbsolute(arg) ? arg : resolve(cwd, arg)
  }
  return null
}
