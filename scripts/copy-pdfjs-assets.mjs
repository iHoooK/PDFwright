// Копирует статические ресурсы pdf.js (CMaps для CJK-шрифтов, стандартные
// шрифты, WASM-декодеры JPEG 2000/JBIG2, ICC-профили) в public-папку renderer.
// Папка не хранится в git и собирается перед dev и build.
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', 'pdfjs-dist')
const target = join(root, 'src', 'renderer', 'public', 'pdfjs')

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(join(source, dir), join(target, dir), { recursive: true })
}
console.log(`pdf.js assets copied to ${target}`)
