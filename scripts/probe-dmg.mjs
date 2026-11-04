// ВРЕМЕННО (docs/MACOS_PLAN.md, M3.1): почему запуск программы прямо из смонтированного
// .dmg зависал на macOS 26 arm64. Сравнивает форматы образа и способ запуска, пишет время
// до окна и до открытого документа, а если программа долго молчит — состояние процессов и
// стеки. Запуск: node scripts/probe-dmg.mjs <образ.dmg> <файл.pdf> <папка итогов>
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const [dmgArg, pdfArg, outArg] = process.argv.slice(2)
const dmg = resolve(dmgArg)
const pdf = resolve(pdfArg)
const out = resolve(outArg)
mkdirSync(join(out, 'shots'), { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'dmg-probe-'))
const LIMIT = Number(process.env.PROBE_LIMIT_S ?? 240) * 1000
const FRAMEWORK = 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'
const rows = []
let port = 9400

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function run(command, args, timeout = 120_000) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 256 << 20
  })
  return `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`
}

function note(text) {
  console.log(text)
}

function purge() {
  run('sudo', ['purge'])
}

function detail(label, text) {
  appendFileSync(join(out, 'details.log'), `\n===== ${label} =====\n${text}\n`)
}

function processes() {
  return run('ps', ['-axo', 'pid,ppid,stat,etime,pcpu,rss,command'])
    .split('\n')
    .filter((line) => /PDFwright|diskimages|hdiutil|syspolicyd|amfid|XProtect/.test(line))
    .filter((line) => !line.includes('probe-dmg'))
    .join('\n')
}

function mainPid(appPath) {
  const lines = run('pgrep', ['-fl', `${appPath}/Contents/MacOS/PDFwright`]).split('\n')
  const main = lines.find((line) => line.includes('MacOS/PDFwright') && !line.includes('--type='))
  return main ? main.trim().split(/\s+/)[0] : null
}

async function kill(appPath) {
  run('pkill', ['-9', '-f', appPath])
  await sleep(1500)
}

/** Запускает программу и ждёт окно и документ через порт отладки Chromium. */
async function launch(label, appPath, how) {
  const debugPort = port++
  const data = mkdtempSync(join(work, 'data-'))
  const args = [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${data}`, pdf]
  const started = Date.now()
  if (how === 'open') {
    note(run('open', ['-n', appPath, '--args', ...args]))
  } else {
    spawn(join(appPath, 'Contents/MacOS/PDFwright'), args, {
      stdio: 'ignore',
      detached: true
    }).unref()
  }
  let windowAt = null
  let readyAt = null
  const marks = new Set()
  while (Date.now() - started < LIMIT) {
    const elapsed = Date.now() - started
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
      signal: AbortSignal.timeout(2000)
    })
      .then((response) => response.json())
      .catch(() => null)
    const pages = (targets ?? []).filter((target) => target.type === 'page')
    if (pages.length > 0 && windowAt === null) windowAt = elapsed
    if (pages.some((target) => target.title.includes(basename(pdf)))) {
      readyAt = elapsed
      break
    }
    // Долгое молчание: состояние процессов, стеки и снимок экрана.
    for (const mark of [30_000, 90_000, 180_000]) {
      if (elapsed >= mark && !marks.has(mark)) {
        marks.add(mark)
        const pid = mainPid(appPath)
        detail(`${label} @${mark / 1000}s: ps`, processes())
        detail(`${label} @${mark / 1000}s: iostat`, run('iostat', ['-d', '-c', '3', '-w', '1']))
        run('screencapture', ['-x', join(out, 'shots', `${label}-${mark / 1000}s.png`)], 15_000)
        if (pid && mark !== 180_000) {
          const file = join(work, `spin-${label}-${mark}.txt`)
          const result = run('sudo', ['spindump', pid, '3', '10', '-file', file], 90_000)
          detail(`${label} @${mark / 1000}s: spindump`, result)
          detail(
            `${label} @${mark / 1000}s: spindump file`,
            run('sudo', ['head', '-n', '220', file])
          )
        }
      }
    }
    await sleep(500)
  }
  const seconds = (ms) => (ms === null ? 'нет' : (ms / 1000).toFixed(1))
  rows.push(`| ${label} | ${how} | ${seconds(windowAt)} | ${seconds(readyAt)} |`)
  note(`${label} (${how}): окно ${seconds(windowAt)} с, документ ${seconds(readyAt)} с`)
  if (readyAt === null) detail(`${label}: процессы при тайм-ауте`, processes())
  await kill(appPath)
}

function attach(image, name) {
  const mount = join(work, `mnt-${name}`)
  mkdirSync(mount, { recursive: true })
  note(
    run('hdiutil', ['attach', image, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount])
  )
  return mount
}

function detach(mount) {
  note(run('hdiutil', ['detach', mount, '-force']))
}

/** Время чтения библиотеки Electron с образа без кэша: насколько образ медленный сам по себе. */
function readSpeed(label, appPath) {
  purge()
  const started = Date.now()
  execFileSync('dd', [`if=${join(appPath, FRAMEWORK)}`, 'of=/dev/null', 'bs=1m'], {
    stdio: 'ignore'
  })
  const seconds = (Date.now() - started) / 1000
  const size = statSync(join(appPath, FRAMEWORK)).size / 1048576
  note(`${label}: чтение ${size.toFixed(0)} МБ за ${seconds.toFixed(1)} с`)
  rows.push(`| ${label}: чтение ${size.toFixed(0)} МБ | dd | | ${seconds.toFixed(1)} |`)
}

note(`Образ ${dmg}: ${(statSync(dmg).size / 1048576).toFixed(1)} МБ`)
note(run('hdiutil', ['imageinfo', '-format', dmg]))
note(run('sw_vers', []))
note(run('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.ncpu', 'hw.memsize']))

// Как собран в выпуске: первый запуск без кэша, повтор с кэшем, после проверки подписи и через open.
{
  const mount = attach(dmg, 'built')
  const appPath = join(mount, 'PDFwright.app')
  purge()
  await launch('built-cold', appPath, 'exec')
  await launch('built-warm', appPath, 'exec')
  note(run('codesign', ['--verify', '--deep', '--strict', appPath], 300_000))
  await launch('built-after-codesign', appPath, 'exec')
  purge()
  await launch('built-open-cold', appPath, 'open')
  readSpeed('built', appPath)
  // Опорная точка: та же программа, скопированная на диск.
  const copy = join(work, 'copy', 'PDFwright.app')
  note(run('ditto', [appPath, copy], 300_000))
  detach(mount)
  purge()
  await launch('copy-cold', copy, 'exec')
  await launch('copy-warm', copy, 'exec')
}

// Другие форматы образа: тот же том, другое сжатие.
for (const format of ['UDZO', 'ULFO', 'UDRO']) {
  const image = join(work, `${format}.dmg`)
  const started = Date.now()
  note(run('hdiutil', ['convert', dmg, '-format', format, '-o', image], 900_000))
  note(
    `${format}: ${(statSync(image).size / 1048576).toFixed(1)} МБ, преобразование ${((Date.now() - started) / 1000).toFixed(0)} с`
  )
  const mount = attach(image, format)
  const appPath = join(mount, 'PDFwright.app')
  purge()
  await launch(`${format}-cold`, appPath, 'exec')
  await launch(`${format}-warm`, appPath, 'exec')
  readSpeed(format, appPath)
  detach(mount)
}

const table = [
  '| Сценарий | Запуск | Окно, с | Документ, с |',
  '| --- | --- | --- | --- |',
  ...rows
]
writeFileSync(join(out, 'probe-table.md'), `${table.join('\n')}\n`)
note(table.join('\n'))
