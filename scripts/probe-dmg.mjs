// ВРЕМЕННО (выпуск 1.0.1): запуск как у пользователя — образ смонтирован обычным образом,
// программу открывает Finder, кэш диска не сбрасывается. Плюс настоящий ⌘P в собранной программе.
// Запуск: node scripts/probe-dmg.mjs <образ.dmg> <файл.pdf> <папка итогов>
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [dmgArg, pdfArg, outArg] = process.argv.slice(2)
const dmg = resolve(dmgArg)
const pdf = resolve(pdfArg)
const out = resolve(outArg)
const shots = join(out, 'shots')
mkdirSync(shots, { recursive: true })
const LIMIT = 200_000
const rows = []

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
function run(command, args, timeout = 60_000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 64 << 20 })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}
const script = (text, timeout = 8_000) => run('osascript', ['-e', text], timeout)
const shot = (name) => run('screencapture', ['-x', join(shots, `${name}.png`)])

function attach() {
  const output = run('hdiutil', ['attach', dmg, '-noautoopen'], 300_000)
  const mount = output
    .split('\n')
    .map((line) => line.split('\t').at(-1).trim())
    .find((part) => part.startsWith('/Volumes/'))
  if (!mount) throw new Error(`образ не смонтирован: ${output}`)
  return mount
}

async function detach(mount) {
  await sleep(2_000)
  console.log(run('hdiutil', ['detach', mount, '-force']))
}

async function stop() {
  run('pkill', ['-9', '-f', 'PDFwright.app'])
  await sleep(2_000)
}

function windows() {
  const answer = script(
    'tell application "System Events" to count windows of (first process whose name is "PDFwright")'
  )
  return Number.parseInt(answer, 10) || 0
}

/** Запускает и ждёт окно по System Events: так же видит его и пользователь. */
async function measure(label, how, app) {
  const started = Date.now()
  how(app)
  let processAt = null
  let windowAt = null
  while (Date.now() - started < LIMIT && windowAt === null) {
    const elapsed = Date.now() - started
    if (processAt === null && run('pgrep', ['-f', `${app}/Contents/MacOS/PDFwright`])) {
      processAt = elapsed
    }
    if (processAt !== null && windows() > 0) windowAt = Date.now() - started
    await sleep(300)
  }
  const seconds = (ms) => (ms === null ? 'нет за 200 с' : (ms / 1000).toFixed(1))
  rows.push(`| ${label} | ${seconds(processAt)} | ${seconds(windowAt)} |`)
  console.log(`${label}: процесс ${seconds(processAt)}, окно ${seconds(windowAt)} с`)
  if (windowAt === null) {
    console.log(run('ps', ['-axo', 'pid,stat,etime,pcpu,command']).slice(0, 4_000))
    shot(`${label}-timeout`)
  }
  await stop()
}

const finder = (app) => {
  script(`tell application "Finder" to open POSIX file "${app}"`, 20_000)
}
const opener = (app) => {
  run('open', [app])
}

console.log(run('sw_vers', []))
console.log(run('hdiutil', ['imageinfo', '-format', dmg]))

// Окно образа — для глаз, как при двойном щелчке по .dmg.
{
  const mount = attach()
  run('open', [mount])
  await sleep(4_000)
  shot('dmg-window')
  script(`tell application "Finder" to close every window`)
  await detach(mount)
}

for (const attempt of [1, 2, 3]) {
  const mount = attach()
  await measure(`Finder, с образа, попытка ${attempt}`, finder, join(mount, 'PDFwright.app'))
  await detach(mount)
}
{
  const mount = attach()
  await measure('open, с образа', opener, join(mount, 'PDFwright.app'))
  await detach(mount)
}
{
  run('sudo', ['purge'])
  const mount = attach()
  run('sudo', ['purge'])
  await measure('Finder, с образа, кэш сброшен', finder, join(mount, 'PDFwright.app'))
  await detach(mount)
}
const installed = '/Applications/PDFwright.app'
{
  const mount = attach()
  console.log(run('ditto', [join(mount, 'PDFwright.app'), installed], 300_000))
  await detach(mount)
  await measure('Finder, из «Программ»', finder, installed)
  await measure('Finder, из «Программ», повтор', finder, installed)
}

// Настоящий ⌘P в собранной программе: без принтера и с принтером.
async function printStep(name) {
  run('open', ['-a', installed, pdf])
  await sleep(12_000)
  script('tell application "PDFwright" to activate')
  await sleep(1_000)
  script('tell application "System Events" to keystroke "p" using command down')
  await sleep(10_000)
  shot(name)
  console.log(
    `${name}: ${script('tell application "System Events" to get name of windows of (first process whose name is "PDFwright")')}`
  )
  await stop()
}
console.log(`принтеры: ${run('lpstat', ['-p'])}`)
await printStep('print-no-printer')
console.log(
  run('sudo', [
    'lpadmin',
    '-p',
    'CI_Printer',
    '-E',
    '-v',
    'lpd://127.0.0.1/ci',
    '-P',
    '/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/PrintCore.framework/Versions/A/Resources/Generic.ppd'
  ])
)
await printStep('print-with-printer')

const table = ['| Сценарий | Процесс, с | Окно, с |', '| --- | --- | --- |', ...rows].join('\n')
writeFileSync(join(out, 'probe-table.md'), `${table}\n`)
console.log(table)
