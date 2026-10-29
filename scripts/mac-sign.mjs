// Подпись Mac-сборки для electron-builder (mac.sign в electron-builder.yml, docs/MACOS_PLAN.md, M2.2).
//
// Общие extraFiles (LICENSE.txt, PRIVACY.md, THIRD_PARTY_NOTICES.md) electron-builder
// на Mac кладёт прямо в PDFwright.app/Contents, а codesign считает файлы в корне Contents
// вложенным кодом и не подписывает программу («code object is not signed at all»).
// Верхний уровень конфигурации общий с Windows и не меняется, поэтому документы
// переносятся в Contents/Resources здесь, перед подписью. Подписывает тот же
// @electron/osx-sign, который electron-builder вызывает без своей функции подписи;
// identity из mac.identity («-» — ad-hoc).
import { rename } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { signAsync } = createRequire(import.meta.url)('@electron/osx-sign')
const DOCS = ['LICENSE.txt', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md']

export async function sign(options) {
  const contents = join(options.app, 'Contents')
  for (const name of DOCS) {
    try {
      await rename(join(contents, name), join(contents, 'Resources', name))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  await signAsync(options)
}
