// ВРЕМЕННО (docs/MACOS_PLAN.md, M3.1): что делает ⌘P на Mac без принтера и с принтером.
// Запуск: node scripts/probe-print.mjs <файл.pdf> <папка итогов>
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const [pdfArg, outArg] = process.argv.slice(2)
const pdf = resolve(pdfArg)
const shots = join(resolve(outArg), 'shots')
mkdirSync(shots, { recursive: true })
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const sh = (command, args, timeout = 30_000) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout })
  return `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`.trim()
}
const WINDOWS =
  'tell application "System Events" to get {name, name of windows} of (processes whose background only is false)'
const withTimeout = (promise, ms) =>
  Promise.race([promise, sleep(ms).then(() => 'нет ответа за отведённое время')])

async function scenario(name) {
  console.log(`\n===== ${name} =====`)
  const data = mkdtempSync(join(tmpdir(), 'print-probe-'))
  const app = await electron.launch({
    cwd: process.cwd(),
    args: ['.', pdf],
    env: { ...process.env, PDFWRIGHT_USER_DATA: data, ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })
  const printers = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.getPrintersAsync()).map((p) => p.name)
  )
  console.log('принтеры:', JSON.stringify(printers))
  await app.evaluate(({ BrowserWindow }) => {
    const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents)
    const original = proto.print
    const started = Date.now()
    globalThis.printLog = []
    proto.print = function (options, callback) {
      globalThis.printLog.push(`print() через ${Date.now() - started} мс`)
      return original.call(this, options, (success, reason) => {
        globalThis.printLog.push(`callback ${success} «${reason}» через ${Date.now() - started} мс`)
        callback(success, reason)
      })
    }
  })
  await page.keyboard.press('Meta+p')
  const started = Date.now()
  for (const at of [3, 10, 30]) {
    await sleep(at * 1000 - (Date.now() - started))
    const log = await withTimeout(
      app.evaluate(({ BrowserWindow }) => ({
        windows: BrowserWindow.getAllWindows().map((w) => `${w.getTitle()} видно=${w.isVisible()}`),
        log: globalThis.printLog
      })),
      5000
    )
    const toast = await withTimeout(
      page
        .getByRole('status')
        .allTextContents()
        .catch((e) => e.message),
      5000
    )
    console.log(`через ${at} с:`, JSON.stringify(log), 'сообщение:', JSON.stringify(toast))
    console.log('окна системы:', sh('osascript', ['-e', WINDOWS]))
    sh('screencapture', ['-x', join(shots, `print-${name}-${at}s.png`)])
  }
  // Настоящий Esc: закрывает системное окно печати, если оно открыто.
  console.log('Esc:', sh('osascript', ['-e', 'tell application "System Events" to key code 53']))
  await sleep(3000)
  const after = await withTimeout(
    app.evaluate(({ BrowserWindow }) => ({
      windows: BrowserWindow.getAllWindows().length,
      log: globalThis.printLog
    })),
    5000
  )
  console.log('после Esc:', JSON.stringify(after))
  sh('screencapture', ['-x', join(shots, `print-${name}-after.png`)])
  app.process().kill('SIGKILL')
  await sleep(1500)
}

console.log('lpstat до:', sh('lpstat', ['-p', '-d']))
await scenario('no-printer')
const ppd =
  '/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/PrintCore.framework/Versions/A/Resources/Generic.ppd'
try {
  execFileSync(
    'sudo',
    ['lpadmin', '-p', 'CI_Printer', '-E', '-v', 'lpd://127.0.0.1/ci', '-P', ppd],
    { stdio: 'inherit', timeout: 60_000 }
  )
} catch (error) {
  console.log('lpadmin:', error.message)
}
console.log('lpstat после:', sh('lpstat', ['-p', '-d']))
await scenario('printer')
process.exit(0)
