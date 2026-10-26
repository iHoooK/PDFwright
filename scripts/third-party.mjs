// Перечень сторонних компонентов, попадающих в программу, из package-lock.json.
// Корни — пакеты, которые реально загружаются в рантайме; дальше обходим их
// зависимости. Результат пишется в THIRD_PARTY_NOTICES.md между маркерами.
//   node scripts/third-party.mjs          — обновить файл
//   node scripts/third-party.mjs --check  — упасть, если файл устарел (для выпуска)
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_ROOTS = [
  'electron',
  'react',
  'react-dom',
  '@fluentui/react-icons',
  'pdfjs-dist',
  'pdf-lib',
  '@pdf-lib/fontkit',
  'mupdf',
  'tesseract.js',
  'tesseract.js-core',
  '@tesseract.js-data/rus',
  '@tesseract.js-data/eng',
  'electron-updater'
]
const START = '<!-- deps:start -->'
const END = '<!-- deps:end -->'

const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
const packages = lock.packages

/** Ищет пакет так же, как Node: от вложенного node_modules вверх к корню. */
function resolvePackage(fromPath, name) {
  let base = fromPath
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`
    if (packages[candidate]) return candidate
    if (!base) return null
    const index = base.lastIndexOf('/node_modules/')
    base = index === -1 ? '' : base.slice(0, index)
  }
}

const seen = new Map()
const queue = RUNTIME_ROOTS.map((name) => resolvePackage('', name)).filter(Boolean)
while (queue.length > 0) {
  const path = queue.shift()
  if (seen.has(path)) continue
  const info = packages[path]
  seen.set(path, info)
  // electron — бинарная среда; её npm-зависимости (загрузчик) в программу не попадают.
  if (path === 'node_modules/electron') continue
  // optionalDependencies не обходим: у pdfjs-dist это @napi-rs/canvas для Node,
  // в браузерную сборку renderer он не попадает.
  for (const dep of Object.keys(info.dependencies ?? {})) {
    const resolved = resolvePackage(path, dep)
    if (resolved) queue.push(resolved)
  }
}

const rows = [...seen.entries()]
  .map(([path, info]) => ({
    name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
    version: info.version ?? '?',
    license: info.license ?? 'см. пакет'
  }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
const unique = rows.filter(
  (row, i) => i === 0 || row.name !== rows[i - 1].name || row.version !== rows[i - 1].version
)

const table = [
  START,
  '',
  `Сгенерировано \`node scripts/third-party.mjs\` из \`package-lock.json\`: ${unique.length} пакетов.`,
  '',
  '| Пакет | Версия | Лицензия |',
  '| --- | --- | --- |',
  ...unique.map((r) => `| ${r.name} | ${r.version} | ${r.license} |`),
  '',
  END
].join('\n')

const noticesPath = join(root, 'THIRD_PARTY_NOTICES.md')
const notices = await readFile(noticesPath, 'utf8')
let next
if (notices.includes(START) && notices.includes(END)) {
  next =
    notices.slice(0, notices.indexOf(START)) +
    table +
    notices.slice(notices.indexOf(END) + END.length)
} else {
  next = `${notices.trimEnd()}\n\n## Полный перечень пакетов в поставке\n\n${table}\n`
}

// PDFwright под AGPL-3.0-or-later: GPLv3/AGPLv3 совместимы, а GPL-2.0-only,
// SSPL и проприетарные лицензии — нет.
const disallowed = unique.filter((r) =>
  /GPL-2\.0(-only)?$|GPL-2\.0-only|SSPL|UNLICENSED|Commercial|Proprietary/i.test(r.license)
)
if (disallowed.length > 0) {
  console.error('Несовместимые лицензии:', disallowed)
  process.exit(1)
}

if (process.argv.includes('--check')) {
  // Сравниваем без учёта форматирования prettier (выравнивание таблиц).
  const norm = (text) =>
    text
      .replace(/[ \t]+/g, ' ')
      .replace(/\| -+/g, '| -')
      .replace(/-+ \|/g, '- |')
  if (norm(next) !== norm(notices)) {
    console.error('THIRD_PARTY_NOTICES.md устарел: выполните node scripts/third-party.mjs')
    process.exit(1)
  }
  console.log(`THIRD_PARTY_NOTICES.md актуален (${unique.length} пакетов)`)
} else {
  await writeFile(noticesPath, next)
  console.log(`THIRD_PARTY_NOTICES.md обновлён: ${unique.length} пакетов`)
}
