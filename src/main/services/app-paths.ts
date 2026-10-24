/**
 * Portable-сборка electron-builder выставляет переменную окружения
 * PORTABLE_EXECUTABLE_DIR. По ней приложение понимает, что установлено не
 * через установщик, и в фазе обновлений предлагает только ссылку на релиз.
 */
export function isPortableBuild(env: NodeJS.ProcessEnv = process.env): boolean {
  const dir = env.PORTABLE_EXECUTABLE_DIR
  return typeof dir === 'string' && dir.length > 0
}
