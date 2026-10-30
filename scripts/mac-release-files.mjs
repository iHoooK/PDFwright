// Собирает выпускные Mac-файлы из раздельных сборок по процессорам (docs/MACOS_PLAN.md, M2.2).
//
// electron-builder подставляет процессор в имя только как arm64/x64, поэтому
// scripts/build-release-mac.sh собирает каждый процессор отдельным запуском в свою
// папку (build/mac-arm64, build/mac-x64), и в каждой получается свой latest-mac.yml
// только со своими файлами. Этот скрипт без зависимостей:
//   - сверяет каждый latest-mac.yml с файлами рядом (размер и sha512) и с версией package.json;
//   - копирует .dmg и .zip в выходную папку;
//   - пишет общий latest-mac.yml: сначала оба .zip (Apple Silicon первым — его берут
//     старые поля path/sha512), затем оба .dmg;
//   - пишет SHA256SUMS-Mac.txt для всех .dmg и .zip.
// Блок-карты (.blockmap) не публикуются, поэтому blockMapSize из записей убирается.
//
// Запуск: node scripts/mac-release-files.mjs <выходная папка> <папка сборки>...
// Пример: node scripts/mac-release-files.mjs build build/mac-arm64 build/mac-x64
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILE_NAME = /^PDFwright-(Portable-)?Mac-(AppleSilicon|Intel)\.(dmg|zip)$/
const TOP_KEYS = new Set(['version', 'files', 'path', 'sha512', 'releaseDate'])
const FILE_KEYS = new Set(['url', 'sha512', 'size', 'blockMapSize'])

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function unquote(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value)
  return value
}

// latest-mac.yml от electron-builder — плоский YAML известного вида. Любая
// незнакомая строка — ошибка: лучше остановить выпуск, чем записать неполный файл.
function parseLatestMac(text, source) {
  const info = { files: [] }
  let inFiles = false
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue
    const where = `${source}:${index + 1}`
    let match
    if ((match = /^([A-Za-z][A-Za-z0-9]*):(?: (.*))?$/.exec(line))) {
      const [, key, value = ''] = match
      if (!TOP_KEYS.has(key)) fail(`${where}: незнакомый ключ ${key}`)
      inFiles = key === 'files'
      if (!inFiles) info[key] = unquote(value)
    } else if (inFiles && (match = /^ {2}- ([A-Za-z][A-Za-z0-9]*): (.*)$/.exec(line))) {
      info.files.push({})
      setFileKey(info.files.at(-1), match[1], match[2], where)
    } else if (
      inFiles &&
      info.files.length > 0 &&
      (match = /^ {4}([A-Za-z][A-Za-z0-9]*): (.*)$/.exec(line))
    ) {
      setFileKey(info.files.at(-1), match[1], match[2], where)
    } else {
      fail(`${where}: непонятная строка «${line}»`)
    }
  }
  return info
}

function setFileKey(file, key, value, where) {
  if (!FILE_KEYS.has(key)) fail(`${where}: незнакомый ключ файла ${key}`)
  file[key] = key === 'size' || key === 'blockMapSize' ? Number(unquote(value)) : unquote(value)
}

function hashFile(path, algorithm, encoding) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash(algorithm)
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest(encoding)))
  })
}

// Порядок: .zip раньше .dmg (обновлятор и старые поля path/sha512 смотрят на .zip),
// внутри — Apple Silicon раньше Intel.
function order(name) {
  const [, , cpu, ext] = FILE_NAME.exec(name)
  return (ext === 'zip' ? 0 : 2) + (cpu === 'AppleSilicon' ? 0 : 1)
}

const [outArg, ...buildArgs] = process.argv.slice(2)
if (!outArg || buildArgs.length === 0) {
  fail(
    'укажите выходную папку и хотя бы одну папку сборки: node scripts/mac-release-files.mjs build build/mac-arm64 build/mac-x64'
  )
}
const outDir = resolve(outArg)
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

const files = []
const releaseDates = []
for (const buildArg of buildArgs) {
  const buildDir = resolve(buildArg)
  const ymlPath = join(buildDir, 'latest-mac.yml')
  const info = parseLatestMac(await readFile(ymlPath, 'utf8'), ymlPath)
  if (info.version !== version)
    fail(`${ymlPath}: версия ${info.version}, в package.json ${version}`)
  if (info.files.length === 0) fail(`${ymlPath}: нет файлов`)
  if (info.releaseDate) releaseDates.push(info.releaseDate)
  for (const entry of info.files) {
    if (!FILE_NAME.test(entry.url ?? '')) fail(`${ymlPath}: неожиданное имя файла ${entry.url}`)
    if (files.some((known) => known.url === entry.url))
      fail(`${entry.url} встречается в двух сборках`)
    const source = join(buildDir, entry.url)
    const { size } = await stat(source)
    if (entry.size !== undefined && size !== entry.size)
      fail(`${source}: размер ${size}, в latest-mac.yml ${entry.size}`)
    if ((await hashFile(source, 'sha512', 'base64')) !== entry.sha512)
      fail(`${source}: sha512 не совпадает с latest-mac.yml`)
    files.push({ url: entry.url, sha512: entry.sha512, size, source })
  }
}
files.sort((a, b) => order(a.url) - order(b.url))
if (!files.some((file) => file.url.endsWith('.zip')))
  fail('в сборках нет ни одного .zip: latest-mac.yml без них бесполезен')

await mkdir(outDir, { recursive: true })
for (const file of files) {
  const target = join(outDir, file.url)
  if (resolve(file.source) !== target) await copyFile(file.source, target)
}

const firstZip = files.find((file) => file.url.endsWith('.zip'))
const releaseDate = releaseDates.sort().at(-1) ?? new Date().toISOString()
const yml = [
  `version: ${version}`,
  'files:',
  ...files.flatMap((file) => [
    `  - url: ${file.url}`,
    `    sha512: ${file.sha512}`,
    `    size: ${file.size}`
  ]),
  `path: ${firstZip.url}`,
  `sha512: ${firstZip.sha512}`,
  `releaseDate: '${releaseDate}'`,
  ''
].join('\n')
await writeFile(join(outDir, 'latest-mac.yml'), yml)

const sums = []
for (const file of [...files].sort((a, b) => a.url.localeCompare(b.url))) {
  sums.push(`${await hashFile(join(outDir, file.url), 'sha256', 'hex')}  ${file.url}`)
}
await writeFile(join(outDir, 'SHA256SUMS-Mac.txt'), sums.join('\n') + '\n')

console.log(`mac-release-files: ${files.map((file) => file.url).join(', ')}`)
console.log(`  ${join(outArg, 'latest-mac.yml')} и ${join(outArg, 'SHA256SUMS-Mac.txt')}`)
