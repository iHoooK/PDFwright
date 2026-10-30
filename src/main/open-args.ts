import { isAbsolute, resolve } from 'node:path'

/**
 * Достаёт пути к PDF из аргументов запуска: двойной клик по файлу в Проводнике
 * передаёт его последним аргументом, а несколько файлов, брошенных на ярлык, —
 * подряд. Флаги Electron/Chromium (`--...`) и служебный `.` из `electron .`
 * игнорируются. Берутся все аргументы с расширением .pdf по порядку, без
 * повторов; относительный путь разрешается от cwd.
 */
export function extractPdfPaths(argv: readonly string[], cwd: string): string[] {
  const paths: string[] = []
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--') || arg === '.') continue
    if (!isPdfPath(arg)) continue
    const path = isAbsolute(arg) ? arg : resolve(cwd, arg)
    if (!paths.includes(path)) paths.push(path)
  }
  return paths
}

/** Файл PDF по расширению, в любом регистре. */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}
