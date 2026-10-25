// Собирает иконки приложения из resources/icon.svg без внешних зависимостей:
// рендерит SVG в PNG через скрытое окно Electron и упаковывает PNG-кадры в ICO.
// Запуск: npx electron scripts/build-icons.mjs
import { app, BrowserWindow } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'resources', 'icon.svg')
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const PNG_SIZES = [512, 256, 32]

// Рисуем SVG на canvas внутри страницы и забираем PNG как data URL:
// это не зависит от видимости окна и композитора, в отличие от capturePage.
async function renderPng(window, svg, size) {
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  const dataUrl = await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = ${size}; c.height = ${size}
        c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
        resolve(c.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('svg load failed'))
      img.src = ${JSON.stringify(src)}
    })`)
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

function buildIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  const dir = Buffer.alloc(16 * frames.length)
  let offset = 6 + dir.length
  frames.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...frames.map((f) => f.png)])
}

app.whenReady().then(async () => {
  const svg = await readFile(svgPath, 'utf8')
  const window = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  try {
    await window.loadURL('data:text/html;charset=utf-8,<!doctype html><title>icons</title>')
    await mkdir(join(root, 'installer'), { recursive: true })
    const frames = []
    for (const size of ICO_SIZES) frames.push({ size, png: await renderPng(window, svg, size) })
    await writeFile(join(root, 'installer', 'icon.ico'), buildIco(frames))
    for (const size of PNG_SIZES) {
      const png = await renderPng(window, svg, size)
      await writeFile(join(root, size === 512 ? 'installer' : 'resources', size === 512 ? 'icon.png' : `icon-${size}.png`), png)
    }
    console.log(`icons: installer/icon.ico (${ICO_SIZES.join(',')}), installer/icon.png 512, resources/icon-256.png, resources/icon-32.png`)
  } finally {
    window.destroy()
    app.quit()
  }
})
