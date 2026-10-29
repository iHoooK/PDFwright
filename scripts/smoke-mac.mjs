// Дымовой запуск собранной Mac-программы (docs/MACOS_PLAN.md, M2.3): открывает
// PDFwright.app с PDF в аргументах, ждёт первую страницу документа и сверяет
// версию, процессор и признак собранной программы. Папка данных временная
// (--user-data-dir): настройки пользователя не трогаются, а уже запущенный
// PDFwright не перехватывает запуск. Вызывается из scripts/build-release-mac.sh.
//
// Запуск: node scripts/smoke-mac.mjs <PDFwright.app> <файл.pdf> <arm64|x64> [папка для снимков]
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
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

// Если программа долго не отвечает: снимок экрана (системное окно или диалог видны
// на нём), процессы PDFwright и системный журнал за последние минуты — в вывод и в снимки.
function diagnose(stage) {
  const run = (command, args) => {
    try {
      return execFileSync(command, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 << 20 })
    } catch (error) {
      return `${command}: ${error.message}`
    }
  }
  console.error(`smoke-mac: программа не ответила (${stage}), сведения для разбора:`)
  if (shotsArg) {
    mkdirSync(resolve(shotsArg), { recursive: true })
    console.error(run('screencapture', ['-x', join(resolve(shotsArg), `failure-${arch}.png`)]))
  }
  const processes = run('ps', ['-axo', 'pid,stat,etime,command'])
  console.error(
    processes
      .split('\n')
      .filter((line) => line.includes('PDFwright'))
      .join('\n')
  )
  const predicate =
    'process BEGINSWITH "PDFwright" OR process == "SecurityAgent" OR process == "UserNotificationCenter"'
  const log = run('log', ['show', '--last', '3m', '--style', 'compact', '--predicate', predicate])
  console.error(log.split('\n').slice(-120).join('\n'))
}

const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const userData = await mkdtemp(join(tmpdir(), 'pdfwright-smoke-'))
// Playwright при тайм-ауте закрывает программу, поэтому сведения собираются раньше.
const watchdog = setTimeout(() => diagnose('запуск'), 45_000)
const app = await electron.launch({
  executablePath: join(resolve(appArg), 'Contents', 'MacOS', 'PDFwright'),
  args: [`--user-data-dir=${userData}`, resolve(pdfArg)],
  timeout: 90_000
})
clearTimeout(watchdog)
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
} catch (error) {
  diagnose('окно и первая страница')
  throw error
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
