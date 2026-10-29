// Сравнение снимков экрана по пикселям (план docs/MACOS_PLAN.md, правило 4 и
// M3.3): «Windows не изменилась», если снимки docs:shots и site:shots совпадают
// с эталоном везде, кроме мест, которые меняются от прогона к прогону сами
// (путь со случайной временной папкой, время). Эти места перечислены в
// docs/mac/windows-shots-allow.json. Без зависимостей: PNG читается через zlib.
//   node scripts/compare-shots.mjs [--ref <коммит>] <папка|файл>…
//     — снимки из рабочей папки против тех же файлов в коммите (по умолчанию HEAD);
//   node scripts/compare-shots.mjs --dirs <папка-A> <папка-B>
//     — одноимённые снимки двух папок.
// Параметры:
//   --allow <json>       — области, где отличия допустимы: {"<имя.png>": [[x0, y0, x1, y1], …]};
//   --tolerance <0–255>  — разница канала, которая ещё не считается отличием;
//   --max-pixels <доля>  — доля пикселей, которым можно отличаться (по умолчанию 0);
//   --diff <папка>       — карты отличий: отличия красным поверх бледного снимка;
//   --write-allow <json> — дописать в файл найденные отличия как допустимые области
//                          (с запасом), чтобы собрать список по нескольким прогонам.
// Код выхода 1, если хоть один снимок отличается сверх допуска, пропал или появился.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

const DEFAULTS = { tolerance: 16, maxPixels: 0 }

const options = parseArgs(process.argv.slice(2))
const allow = options.allow ? JSON.parse(readFileSync(options.allow, 'utf8')) : {}
const learned = {}
const pairs = options.dirs ? dirPairs(...options.dirs) : refPairs(options.ref, options.paths)
let failed = 0
for (const pair of pairs) {
  const result = compare(pair)
  if (!result.ok) failed++
  console.log(`${result.mark} ${pair.name}: ${result.text}`)
}
console.log(
  `\nСнимков: ${pairs.length}, отличаются: ${failed} ` +
    `(допуск канала ${options.tolerance}, доля пикселей ${options.maxPixels * 100}%` +
    `${options.allow ? `, допустимые области из ${options.allow}` : ''})`
)
if (options.writeAllow) saveLearned(options.writeAllow)
process.exitCode = failed > 0 ? 1 : 0

function parseArgs(args) {
  const parsed = {
    ref: 'HEAD',
    paths: [],
    dirs: null,
    diff: null,
    allow: null,
    writeAllow: null,
    ...DEFAULTS
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--ref') parsed.ref = args[++i]
    else if (arg === '--dirs') parsed.dirs = [args[++i], args[++i]]
    else if (arg === '--tolerance') parsed.tolerance = Number(args[++i])
    else if (arg === '--max-pixels') parsed.maxPixels = Number(args[++i])
    else if (arg === '--diff') parsed.diff = resolve(args[++i])
    else if (arg === '--allow') parsed.allow = resolve(args[++i])
    else if (arg === '--write-allow') parsed.writeAllow = resolve(args[++i])
    else if (arg.startsWith('--')) usage()
    else parsed.paths.push(arg)
  }
  if (parsed.dirs ? parsed.dirs.some((dir) => !dir) : parsed.paths.length === 0) usage()
  return parsed
}

function usage() {
  console.error(
    'node scripts/compare-shots.mjs [--ref <коммит>] <папка|файл>…\n' +
      'node scripts/compare-shots.mjs --dirs <папка-A> <папка-B>\n' +
      '  [--allow <json>] [--tolerance 16] [--max-pixels 0] [--diff <папка>] [--write-allow <json>]'
  )
  process.exit(2)
}

/** Снимки рабочей папки против коммита: и изменённые, и пропавшие, и новые. */
function refPairs(ref, paths) {
  const root = git(['rev-parse', '--show-toplevel'])
  const pairs = []
  for (const path of paths) {
    const rel = relative(root, resolve(path)).replace(/\\/g, '/')
    const committed = git(['ls-tree', '-r', '--name-only', ref, '--', rel])
      .split('\n')
      .filter((name) => name.endsWith('.png'))
    const current = existsSync(path) ? listPng(path).map((file) => relative(root, file)) : []
    const names = new Set([...committed, ...current.map((name) => name.replace(/\\/g, '/'))])
    for (const name of [...names].sort()) {
      pairs.push({
        name,
        a: committed.includes(name) ? () => gitBlob(`${ref}:${name}`) : null,
        b: existsSync(join(root, name)) ? () => readFileSync(join(root, name)) : null
      })
    }
  }
  return pairs
}

function dirPairs(dirA, dirB) {
  const names = new Set([...listPng(dirA), ...listPng(dirB)].map((file) => basename(file)))
  return [...names].sort().map((name) => ({
    name,
    a: existsSync(join(dirA, name)) ? () => readFileSync(join(dirA, name)) : null,
    b: existsSync(join(dirB, name)) ? () => readFileSync(join(dirB, name)) : null
  }))
}

function listPng(path) {
  if (!statSync(path).isDirectory()) return path.endsWith('.png') ? [resolve(path)] : []
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listPng(join(path, entry.name))
      : entry.name.endsWith('.png')
        ? [resolve(path, entry.name)]
        : []
  )
}

function compare(pair) {
  if (!pair.a) return { ok: false, mark: '+', text: 'новый снимок, в эталоне его нет' }
  if (!pair.b) return { ok: false, mark: '-', text: 'снимок пропал' }
  const bufA = pair.a()
  const bufB = pair.b()
  if (bufA.equals(bufB)) return { ok: true, mark: '=', text: 'файлы совпадают' }
  const a = decodePng(bufA)
  const b = decodePng(bufB)
  if (a.width !== b.width || a.height !== b.height) {
    return {
      ok: false,
      mark: '!',
      text: `другой размер: ${a.width}×${a.height} → ${b.width}×${b.height}`
    }
  }
  const allowed = allow[basename(pair.name)] ?? []
  let changed = 0
  let ignored = 0
  let over = 0
  let maxDelta = 0
  const mask = new Uint8Array(a.width * a.height)
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const p = (y * a.width + x) * 4
      let delta = 0
      for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(a.data[p + c] - b.data[p + c]))
      if (delta <= options.tolerance) {
        if (delta > 0) changed++
        continue
      }
      changed++
      if (allowed.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) {
        ignored++
        continue
      }
      over++
      maxDelta = Math.max(maxDelta, delta)
      mask[y * a.width + x] = 1
    }
  }
  const total = a.width * a.height
  const ok = over <= total * options.maxPixels
  const boxes = over > 0 ? clusters(mask, a.width, a.height) : []
  if (options.diff && over > 0) writeDiff(pair.name, b, mask)
  if (options.writeAllow && over > 0) learn(basename(pair.name), boxes, a)
  const share = (n) => `${((n / total) * 100).toFixed(3)}%`
  const where = boxes
    .slice(0, 8)
    .map(([x0, y0, x1, y1]) => `${x0},${y0}–${x1},${y1}`)
    .join('; ')
  return {
    ok,
    mark: over === 0 ? '≈' : ok ? '~' : '✗',
    text:
      `отличаются ${changed} пикс. (${share(changed)})` +
      (ignored > 0 ? `, из них в допустимых областях ${ignored}` : '') +
      (over > 0
        ? `, вне допуска ${over} (${share(over)}), наибольшая разница ${maxDelta}, ` +
          `области: ${where}${boxes.length > 8 ? ` и ещё ${boxes.length - 8}` : ''}`
        : '')
  }
}

/** Отличия, собранные в прямоугольники: соседние в пределах строки текста — вместе. */
function clusters(mask, width, height, gapX = 12, gapY = 4) {
  let boxes = []
  for (let y = 0; y < height; y++) {
    let start = -1
    let last = -1
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      if (start !== -1 && x - last <= gapX) {
        last = x
        continue
      }
      if (start !== -1) boxes.push([start, y, last, y])
      start = last = x
    }
    if (start !== -1) boxes.push([start, y, last, y])
  }
  return mergeBoxes(boxes, gapX, gapY)
}

function mergeBoxes(input, gapX, gapY) {
  let boxes = input.map((box) => [...box])
  for (let merged = true; merged;) {
    merged = false
    const out = []
    for (const box of boxes) {
      const hit = out.find(
        (o) =>
          box[0] <= o[2] + gapX &&
          o[0] <= box[2] + gapX &&
          box[1] <= o[3] + gapY &&
          o[1] <= box[3] + gapY
      )
      if (!hit) {
        out.push(box)
        continue
      }
      hit[0] = Math.min(hit[0], box[0])
      hit[1] = Math.min(hit[1], box[1])
      hit[2] = Math.max(hit[2], box[2])
      hit[3] = Math.max(hit[3], box[3])
      merged = true
    }
    boxes = out
  }
  return boxes.sort((p, q) => p[1] - q[1] || p[0] - q[0])
}

/**
 * Запоминает отличия как допустимые области с запасом: по высоте — полстроки,
 * по ширине — 16 высот строки, чтобы покрыть другое имя временной папки и
 * другую дату (у отличий от времени меняются только последние цифры).
 */
function learn(name, boxes, image) {
  const padded = boxes.map(([x0, y0, x1, y1]) => {
    const h = y1 - y0 + 1
    return [
      Math.max(0, x0 - h * 16),
      Math.max(0, y0 - Math.ceil(h / 2)),
      Math.min(image.width - 1, x1 + h * 16),
      Math.min(image.height - 1, y1 + Math.ceil(h / 2))
    ]
  })
  learned[name] = [...(learned[name] ?? []), ...padded]
}

function saveLearned(path) {
  const all = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  for (const [name, boxes] of Object.entries(learned)) {
    all[name] = mergeBoxes([...(all[name] ?? []), ...boxes], 0, 0)
  }
  const sorted = Object.fromEntries(Object.entries(all).sort(([p], [q]) => p.localeCompare(q)))
  const lines = Object.entries(sorted).map(
    ([name, boxes]) => `  ${JSON.stringify(name)}: ${JSON.stringify(boxes)}`
  )
  writeFileSync(path, `{\n${lines.join(',\n')}\n}\n`)
  console.log(`Допустимые области записаны в ${path}`)
}

/** PNG 8 бит на канал без чересстрочности (так пишут Chromium и Playwright) → RGBA. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('не PNG')
  let offset = 8
  let header = null
  let palette = null
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        interlace: body[12]
      }
    } else if (type === 'PLTE') palette = body
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header?.color]
  if (!header || header.depth !== 8 || header.interlace !== 0 || !channels) {
    throw new Error('неподдерживаемый PNG (нужен 8 бит на канал без чересстрочности)')
  }
  const { width, height } = header
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = y * stride
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? pixels[out + i - channels] : 0
      const up = y > 0 ? pixels[out - stride + i] : 0
      const upLeft = y > 0 && i >= channels ? pixels[out - stride + i - channels] : 0
      let value = line[i]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) value += paeth(left, up, upLeft)
      pixels[out + i] = value & 0xff
    }
  }
  const data = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const s = p * channels
    const d = p * 4
    if (header.color === 3) {
      data.set(palette.subarray(pixels[s] * 3, pixels[s] * 3 + 3), d)
      data[d + 3] = 255
    } else if (channels <= 2) {
      data.fill(pixels[s], d, d + 3)
      data[d + 3] = channels === 2 ? pixels[s + 1] : 255
    } else {
      data.set(pixels.subarray(s, s + 3), d)
      data[d + 3] = channels === 4 ? pixels[s + 3] : 255
    }
  }
  return { width, height, data }
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Карта отличий: бледный новый снимок, отличия сверх допуска — красным. */
function writeDiff(name, image, mask) {
  const { width, height, data } = image
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const d = row + 1 + x * 3
      if (mask[p]) {
        raw[d] = 255
        raw[d + 1] = 0
        raw[d + 2] = 0
      } else {
        for (let c = 0; c < 3; c++) raw[d + c] = 191 + (data[p * 4 + c] >> 2)
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
  mkdirSync(options.diff, { recursive: true })
  writeFileSync(join(options.diff, name.replace(/[\\/]/g, '__')), png)
}

function chunk(type, body) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function gitBlob(spec) {
  return execFileSync('git', ['cat-file', 'blob', spec], { maxBuffer: 256 * 1024 * 1024 })
}
