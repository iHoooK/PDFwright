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
const LIMIT = Number(process.env.PROBE_LIMIT_S ?? 180) * 1000
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

/** Запускает программу и ждёт окно и документ через порт отладки Chromium, ничего не блокируя. */
async function launch(label, appPath, how) {
  const debugPort = port++
  const data = mkdtempSync(join(work, 'data-'))
  const args = [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${data}`, pdf]
  const started = Date.now()
  let openDone = null
  if (how === 'open') {
    // Как двойной щелчок в Finder: через LaunchServices. open возвращается, когда программа запущена.
    const opener = spawn('open', ['-n', appPath, '--args', ...args], { stdio: 'ignore' })
    opener.on('exit', () => {
      openDone = Date.now() - started
    })
  } else {
    spawn(join(appPath, 'Contents/MacOS/PDFwright'), args, {
      stdio: 'ignore',
      detached: true
    }).unref()
  }
  let processAt = null
  let windowAt = null
  let readyAt = null
  const marks = new Set()
  let diagJob = null
  while (Date.now() - started < LIMIT) {
    const elapsed = Date.now() - started
    if (processAt === null && mainPid(appPath)) processAt = elapsed
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
      signal: AbortSignal.timeout(1000)
    })
      .then((response) => response.json())
      .catch(() => null)
    const pages = (targets ?? []).filter((target) => target.type === 'page')
    if (pages.length > 0 && windowAt === null) windowAt = elapsed
    if (pages.some((target) => target.title.includes(basename(pdf)))) {
      readyAt = elapsed
      break
    }
    // Только в сценарии -diag: кто читает образ и где стоит главный поток; опрос не блокируется.
    if (label.endsWith('-diag') && elapsed >= 20_000 && !diagJob) {
      const pid = mainPid(appPath)
      const io = join(work, `${label}-io.txt`)
      const spin = join(work, `${label}-spin.txt`)
      diagJob = { io, spin, done: false }
      const job = diagJob
      spawn(
        'sh',
        [
          '-c',
          `sudo fs_usage -w -f diskio -t 5 > "${io}" 2>&1; sudo spindump ${pid ?? 0} 3 10 -file "${spin}" >/dev/null 2>&1`
        ],
        { stdio: 'ignore' }
      ).on('exit', () => {
        job.done = true
      })
    }
    // Лёгкий снимок без стеков: кто занят процессором, пока окна нет.
    for (const mark of [10_000, 20_000, 40_000, 80_000, 160_000]) {
      if (elapsed >= mark && !marks.has(mark)) {
        marks.add(mark)
        const top = run('ps', ['-Ao', 'pcpu,stat,comm', '-r']).split('\n').slice(0, 7).join('\n')
        detail(`${label} @${mark / 1000}s`, top)
      }
    }
    await sleep(250)
  }
  const seconds = (ms) => (ms === null ? 'нет' : (ms / 1000).toFixed(1))
  rows.push(
    `| ${label} | ${how} | ${seconds(openDone)} | ${seconds(processAt)} | ${seconds(windowAt)} | ${seconds(readyAt)} |`
  )
  note(
    `${label} (${how}): open ${seconds(openDone)}, процесс ${seconds(processAt)}, окно ${seconds(windowAt)}, документ ${seconds(readyAt)} с`
  )
  if (readyAt === null) detail(`${label}: процессы при тайм-ауте`, processes())
  if (diagJob) {
    for (let i = 0; i < 120 && !diagJob.done; i++) await sleep(500)
    const lines = run('sudo', ['cat', diagJob.io]).split('\n')
    const counts = new Map()
    for (const line of lines) {
      const name = line.trim().split(/\s+/).pop()
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 15)
    detail(`${label}: кто читает диск (fs_usage 5 с)`, top.map(([n, c]) => `${c} ${n}`).join('\n'))
    detail(`${label}: spindump`, run('sudo', ['head', '-n', '200', diagJob.spin]))
  }
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
  rows.push(`| ${label}: чтение ${size.toFixed(0)} МБ | dd | | | | ${seconds.toFixed(1)} |`)
}

note(`Образ ${dmg}: ${(statSync(dmg).size / 1048576).toFixed(1)} МБ`)
note(run('hdiutil', ['imageinfo', '-format', dmg]))
note(run('sw_vers', []))
note(run('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.ncpu', 'hw.memsize']))

// Двойной щелчок (open) против прямого запуска, образ против установленной копии, два формата.
// Каждый запуск без кэша диска; повторный open показывает, разовая ли задержка.
{
  const image = join(work, 'ULFO.dmg')
  note(run('hdiutil', ['convert', dmg, '-format', 'ULFO', '-o', image], 900_000))
  note(`ULFO: ${(statSync(image).size / 1048576).toFixed(1)} МБ`)
  const mount = attach(image, 'ULFO')
  const appPath = join(mount, 'PDFwright.app')
  purge()
  await launch('ULFO-exec', appPath, 'exec')
  purge()
  await launch('ULFO-open-1', appPath, 'open')
  purge()
  await launch('ULFO-open-2', appPath, 'open')
  purge()
  await launch('ULFO-open-diag', appPath, 'open')
  readSpeed('ULFO', appPath)
  const installed = '/Applications/PDFwright.app'
  note(run('ditto', [appPath, installed], 300_000))
  detach(mount)
  purge()
  await launch('installed-open-1', installed, 'open')
  purge()
  await launch('installed-open-2', installed, 'open')
  purge()
  await launch('installed-exec', installed, 'exec')
}
{
  const image = join(work, 'UDBZ.dmg')
  note(run('hdiutil', ['convert', dmg, '-format', 'UDBZ', '-o', image], 900_000))
  note(`UDBZ: ${(statSync(image).size / 1048576).toFixed(1)} МБ`)
  const mount = attach(image, 'UDBZ')
  const appPath = join(mount, 'PDFwright.app')
  purge()
  await launch('UDBZ-exec', appPath, 'exec')
  purge()
  await launch('UDBZ-open-1', appPath, 'open')
  purge()
  await launch('UDBZ-open-2', appPath, 'open')
  readSpeed('UDBZ', appPath)
  detach(mount)
}

const table = [
  '| Сценарий | Запуск | open вернулся, с | Процесс, с | Окно, с | Документ, с |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows
]
writeFileSync(join(out, 'probe-table.md'), `${table.join('\n')}\n`)
note(table.join('\n'))
