// Дымовой запуск собранной Mac-программы (docs/MACOS_PLAN.md, M2.3): открывает
// PDFwright.app с PDF в аргументах, ждёт первую страницу документа и сверяет
// версию, процессор и признак собранной программы. Папка данных временная
// (--user-data-dir): настройки пользователя не трогаются, а уже запущенный
// PDFwright не перехватывает запуск. Вызывается из scripts/build-release-mac.sh.
//
// Запуск: node scripts/smoke-mac.mjs <PDFwright.app> <файл.pdf> <arm64|x64> [папка для снимков]
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [appArg, pdfArg, arch, shotsArg] = process.argv.slice(2)
if (!appArg || !pdfArg || !['arm64', 'x64'].includes(arch)) {
  console.error(
    'Запуск: node scripts/smoke-mac.mjs <PDFwright.app> <файл.pdf> <arm64|x64> [папка для снимков]'
  )
  process.exit(2)
}

const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const userData = await mkdtemp(join(tmpdir(), 'pdfwright-smoke-'))
const app = await electron.launch({
  executablePath: join(resolve(appArg), 'Contents', 'MacOS', 'PDFwright'),
  args: [`--user-data-dir=${userData}`, resolve(pdfArg)],
  timeout: 120_000
})
try {
  const page = await app.firstWindow({ timeout: 120_000 })
  await page.waitForSelector('[data-page="1"] canvas', { timeout: 120_000 })
  const info = await app.evaluate(({ app: electronApp }) => ({
    version: electronApp.getVersion(),
    packaged: electronApp.isPackaged,
    arch: process.arch,
    platform: process.platform,
    userData: electronApp.getPath('userData')
  }))
  console.log(`smoke-mac: ${JSON.stringify(info)}`)
  const problems = []
  if (info.platform !== 'darwin') problems.push(`платформа ${info.platform}`)
  if (!info.packaged) problems.push('программа запущена не из сборки')
  if (info.version !== version) problems.push(`версия ${info.version}, в package.json ${version}`)
  if (info.arch !== arch) problems.push(`процессор ${info.arch}, ожидался ${arch}`)
  if (problems.length > 0) throw new Error(problems.join('; '))

  if (shotsArg) {
    // Снимки для проверки глазами: окно с документом и весь экран (значок в Dock).
    // Нет прав на запись экрана — не ошибка сборки.
    const shots = resolve(shotsArg)
    await mkdir(shots, { recursive: true })
    await page.screenshot({ path: join(shots, `window-${arch}.png`) })
    try {
      execFileSync('screencapture', ['-x', join(shots, `screen-${arch}.png`)], { timeout: 30_000 })
    } catch (error) {
      console.warn(`smoke-mac: снимок экрана не получился: ${error.message}`)
    }
  }
  console.log(`smoke-mac: OK — PDFwright ${info.version} (${info.arch}) открыл ${pdfArg}`)
} finally {
  const child = app.process()
  const exited = new Promise((done) => child.once('exit', done))
  await app
    .evaluate(({ app: electronApp }) => {
      setTimeout(() => electronApp.exit(0), 0)
    })
    .catch(() => undefined)
  await Promise.race([exited, new Promise((done) => setTimeout(done, 10_000))])
  if (child.exitCode === null) child.kill()
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
