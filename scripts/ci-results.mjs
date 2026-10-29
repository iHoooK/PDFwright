// Итоги проверок CI в служебную ветку git (по умолчанию ci/mac-results): вывод
// шагов, сводка summary.md и снимки экрана. Без входа в GitHub логи и артефакты
// прогонов не скачать (403), а ветку можно забрать обычным `git fetch`.
//   node scripts/ci-results.mjs run <шаг> <команда> [аргументы…]
//     — выполняет команду как обычно, копирует её вывод в logs/<шаг>.log и
//       дописывает итог в steps.json; код выхода — как у команды, поэтому шаг
//       workflow помечается continue-on-error, чтобы прогон дошёл до конца.
//   node scripts/ci-results.mjs publish <ветка>/<процессор> [--dry-run]
//     — пишет summary.md и заменяет этой папкой одноимённую папку служебной ветки.
// В служебной ветке один коммит без истории: только последний прогон каждой
// ветки. Задания пишут одновременно, поэтому пуш идёт с --force-with-lease и
// повторяется, если соседнее задание успело обновить ветку раньше.
// Папка результатов — CI_RESULTS_DIR, по умолчанию $RUNNER_TEMP/ci-results;
// снимки e2e пишутся в её подпапку shots (PDFWRIGHT_SHOTS).
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { arch, release, tmpdir, type } from 'node:os'
import { join, resolve } from 'node:path'

const RESULTS = resolve(
  process.env.CI_RESULTS_DIR ?? join(process.env.RUNNER_TEMP ?? tmpdir(), 'ci-results')
)
const BRANCH = process.env.CI_RESULTS_BRANCH ?? 'ci/mac-results'
const STEPS = join(RESULTS, 'steps.json')
const BOT = {
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com'
}

const [mode, ...rest] = process.argv.slice(2)
if (mode === 'run') await run(rest)
else if (mode === 'publish') publish(rest)
else usage()

function usage() {
  console.error(
    'node scripts/ci-results.mjs run <шаг> <команда> [аргументы…]\n' +
      'node scripts/ci-results.mjs publish <ветка>/<процессор> [--dry-run]'
  )
  process.exit(2)
}

async function run([name, command, ...args]) {
  if (!name || !command || !/^[\w.-]+$/.test(name)) usage()
  mkdirSync(join(RESULTS, 'logs'), { recursive: true })
  const log = createWriteStream(join(RESULTS, 'logs', `${name}.log`))
  const started = Date.now()
  // В Windows npm и npx — .cmd, они запускаются только через оболочку.
  const child =
    process.platform === 'win32'
      ? spawn([command, ...args].map(quoteWin).join(' '), {
          stdio: ['inherit', 'pipe', 'pipe'],
          shell: true
        })
      : spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    log.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
    log.write(chunk)
  })

  let recorded = false
  const finish = (code, note) => {
    if (recorded) return
    recorded = true
    const steps = readSteps()
    steps.push({
      name,
      command: [command, ...args].join(' '),
      code,
      seconds: Math.round((Date.now() - started) / 1000),
      ...(note ? { note } : {})
    })
    writeFileSync(STEPS, JSON.stringify(steps, null, 2))
  }
  // Таймаут шага: раннер шлёт SIGINT, затем SIGTERM — записать, что шаг прерван.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      finish(null, 'прерван')
      child.kill(signal)
      log.end(() => process.exit(1))
    })
  }

  const code = await new Promise((done) => {
    child.on('error', (error) => {
      log.write(`${error.message}\n`)
      done(127)
    })
    child.on('close', (exitCode) => done(exitCode ?? 1))
  })
  finish(code)
  await new Promise((done) => log.end(done))
  process.exitCode = code
}

function quoteWin(arg) {
  return /^[\w./:=@-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`
}

function readSteps() {
  return existsSync(STEPS) ? JSON.parse(readFileSync(STEPS, 'utf8')) : []
}

function publish(args) {
  const dest = args.find((arg) => !arg.startsWith('--'))
  if (!dest || dest.startsWith('/') || dest.split('/').some((part) => part === '' || part === '..'))
    usage()
  mkdirSync(RESULTS, { recursive: true })
  const summary = buildSummary(dest)
  writeFileSync(join(RESULTS, 'summary.md'), summary)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  console.log(summary)
  if (!args.includes('--dry-run')) pushResults(dest)
}

function buildSummary(dest) {
  const env = process.env
  const sha = env.GITHUB_SHA ?? tryGit(['rev-parse', 'HEAD']).out
  const subject = tryGit(['log', '-1', '--format=%s', sha]).out
  const runUrl = env.GITHUB_RUN_ID
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : null
  const steps = readSteps()
  const failed = steps.filter((step) => step.code !== 0)
  const lines = [
    `# ${dest}`,
    '',
    `- Коммит: \`${sha.slice(0, 7)}\` ${subject}`,
    runUrl ? `- Прогон: ${runUrl} (попытка ${env.GITHUB_RUN_ATTEMPT ?? 1})` : '- Прогон: локальный',
    `- Машина: ${machine()}`,
    `- Время: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `- Итог: ${failed.length === 0 ? 'все шаги прошли' : `упали ${failed.map((step) => step.name).join(', ')}`}`,
    '',
    '| Шаг | Итог | Время | Тесты | Команда |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const step of steps) {
    const status =
      step.code === 0 ? '✅ прошёл' : step.note ? `⏱ ${step.note}` : `❌ упал (код ${step.code})`
    lines.push(
      `| ${step.name} | ${status} | ${duration(step.seconds)} | ${testCounts(step.name)} | \`${step.command.replace(/\|/g, '\\|')}\` |`
    )
  }
  lines.push('', 'Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.')

  for (const step of failed) {
    lines.push(
      '',
      `## ${step.name}: ошибки`,
      '',
      '```text',
      excerpt(readLog(step.name)),
      '```',
      '',
      `Полный вывод: [logs/${step.name}.log](logs/${step.name}.log)`
    )
  }

  const extra = readdirSync(RESULTS, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !['steps.json', 'summary.md'].includes(entry.name))
    .map((entry) => entry.name)
  if (extra.length > 0) {
    lines.push('', '## Файлы', '', ...extra.map((name) => `- [${name}](${name})`))
  }
  const shotsDir = join(RESULTS, 'shots')
  const shots = existsSync(shotsDir)
    ? readdirSync(shotsDir)
        .filter((name) => name.endsWith('.png'))
        .sort()
    : []
  if (shots.length > 0) {
    lines.push(
      '',
      `## Снимки (${shots.length})`,
      '',
      ...shots.map((name) => `- [${name}](shots/${name})`)
    )
  }
  return `${lines.join('\n')}\n`
}

function machine() {
  const system =
    process.platform === 'darwin'
      ? `macOS ${tryRun('sw_vers', ['-productVersion']).out}`
      : `${type()} ${release()}`
  const electronPkg = resolve('node_modules/electron/package.json')
  const electron = existsSync(electronPkg)
    ? `, Electron ${JSON.parse(readFileSync(electronPkg, 'utf8')).version}`
    : ''
  return `${system} (${arch()}), Node ${process.version.slice(1)}${electron}`
}

function duration(seconds) {
  if (seconds < 60) return `${seconds} с`
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`
}

function readLog(name) {
  const path = join(RESULTS, 'logs', `${name}.log`)
  return existsSync(path) ? stripAnsi(readFileSync(path, 'utf8')) : ''
}

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n')
}

/** Итог vitest («3 failed | 285 passed (288)»), если шаг — тесты. */
function testCounts(name) {
  const match = /^\s*Tests\s{2,}(.+)$/m.exec(readLog(name))
  return match ? match[1].trim().replace(/\|/g, '·') : ''
}

/**
 * Выдержка ошибок: у vitest — раздел «Failed Tests/Suites» и итоговые строки,
 * у остальных — строки с ошибками, иначе хвост вывода.
 */
function excerpt(text) {
  const lines = text.split('\n')
  const totals = lines.filter((line) => /^\s*(Test Files|Tests|Errors)\s{2,}/.test(line))
  const marker = lines.findIndex((line) => /Failed (Tests|Suites) \d+|Unhandled Errors?/.test(line))
  let picked
  if (marker !== -1) {
    picked = lines.slice(marker, marker + 200)
    for (const line of totals) if (!picked.includes(line)) picked.push(line)
  } else {
    const hits = lines.filter((line) => /\berror\b|\bfailed\b|✖|×|ERR!|Error:/i.test(line))
    picked = hits.length > 0 ? hits.slice(0, 80) : lines.slice(-40)
  }
  return picked
    .map((line) => (line.length > 300 ? `${line.slice(0, 300)}…` : line))
    .join('\n')
    .replace(/```/g, "'''")
    .trim()
}

function pushResults(dest) {
  const stage = mkdtempSync(join(tmpdir(), 'ci-results-'))
  const tree = join(stage, 'tree')
  cpSync(RESULTS, join(tree, ...dest.split('/')), { recursive: true })
  writeFileSync(join(tree, 'README.md'), readme())
  const gitDir = git(['rev-parse', '--absolute-git-dir'])
  const index = join(stage, 'index')
  const env = {
    ...process.env,
    GIT_INDEX_FILE: index,
    GIT_AUTHOR_NAME: BOT.name,
    GIT_AUTHOR_EMAIL: BOT.email,
    GIT_COMMITTER_NAME: BOT.name,
    GIT_COMMITTER_EMAIL: BOT.email
  }
  const sha = process.env.GITHUB_SHA ?? git(['rev-parse', 'HEAD'])
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : 'локальный прогон'
  const message = `${dest}: ${sha.slice(0, 7)}\n\n${runUrl}`

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const base = fetchBase()
      rmSync(index, { force: true })
      git(base ? ['read-tree', `${base}^{tree}`] : ['read-tree', '--empty'], { env })
      // Своя папка заменяется целиком, папки других веток остаются как были.
      git(
        [
          '--git-dir',
          gitDir,
          '--work-tree',
          tree,
          'add',
          '--all',
          '--force',
          '--',
          dest,
          'README.md'
        ],
        {
          env,
          cwd: tree
        }
      )
      const commit = git(['commit-tree', git(['write-tree'], { env }), '-m', message], { env })
      const push = tryGit([
        'push',
        '--quiet',
        `--force-with-lease=refs/heads/${BRANCH}:${base}`,
        'origin',
        `${commit}:refs/heads/${BRANCH}`
      ])
      if (push.ok) {
        console.log(`Итоги в ветке ${BRANCH}, папка ${dest}/ (коммит ${commit.slice(0, 7)}).`)
        rmSync(stage, { recursive: true, force: true })
        return
      }
      console.log(`Пуш в ${BRANCH} отклонён (попытка ${attempt}): ${push.err}`)
    } catch (error) {
      console.log(`Ошибка выгрузки в ${BRANCH} (попытка ${attempt}): ${error.message}`)
    }
    sleep(2000 + Math.random() * 6000)
  }
  throw new Error(`не удалось отправить итоги в ветку ${BRANCH}`)
}

/** Текущий коммит служебной ветки или пустая строка, если её ещё нет. */
function fetchBase() {
  const fetch = tryGit([
    'fetch',
    '--quiet',
    '--no-tags',
    '--depth=1',
    'origin',
    `refs/heads/${BRANCH}`
  ])
  if (fetch.ok) return git(['rev-parse', 'FETCH_HEAD'])
  if (/couldn't find remote ref/i.test(fetch.err)) return ''
  throw new Error(fetch.err)
}

function readme() {
  return [
    '# Итоги проверок CI',
    '',
    'Служебная ветка: workflow `.github/workflows/mac.yml` после каждого прогона кладёт сюда',
    'итог в папку `<ветка>/<процессор>/` (`arm64` — Apple Silicon, `x64` — Intel):',
    '',
    '- `summary.md` — какие шаги прошли и какие упали, выдержки ошибок;',
    '- `logs/` — полный вывод каждого шага;',
    '- `shots/` — снимки экрана из e2e (`PDFWRIGHT_SHOTS`).',
    '',
    'В ветке один коммит без истории: прогон заменяет только свою папку. Пишет её',
    '`scripts/ci-results.mjs`. Прочитать:',
    '',
    '```sh',
    `git fetch origin ${BRANCH}`,
    `git show origin/${BRANCH}:mac/prep/arm64/summary.md`,
    `git archive origin/${BRANCH} mac/prep | tar -x -C <папка>`,
    '```',
    ''
  ].join('\n')
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim()
}

function tryGit(args) {
  return tryRun('git', args)
}

function tryRun(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return {
    ok: result.status === 0,
    out: (result.stdout ?? '').trim(),
    err: (result.stderr ?? result.error?.message ?? '').trim()
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
