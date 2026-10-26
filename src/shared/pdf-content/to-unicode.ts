/**
 * Разбор таблицы ToUnicode шрифта PDF (CMap): какому коду символа в потоке
 * содержимого соответствует какая буква. По обратной таблице «буква → код»
 * новый текст пишется тем же шрифтом документа, даже если в урезанном
 * подмножестве шрифта нет собственной таблицы Unicode (так делают Cairo,
 * Word, браузеры при печати в PDF).
 */

/** Буква (одна кодовая точка) → код символа в шестнадцатеричном виде, как в строке `<…> Tj`. */
export type CharCodes = Map<string, string>

function hexToText(hex: string): string | null {
  if (hex.length === 0 || hex.length % 4 !== 0) return null
  const units: number[] = []
  for (let i = 0; i < hex.length; i += 4) units.push(Number.parseInt(hex.slice(i, i + 4), 16))
  if (units.some((u) => Number.isNaN(u))) return null
  return String.fromCharCode(...units)
}

/** Одна кодовая точка или null для лигатур и пустых значений. */
function singleChar(hex: string): string | null {
  const text = hexToText(hex)
  if (text === null) return null
  return Array.from(text).length === 1 ? text : null
}

function addCode(codes: CharCodes, char: string | null, code: string): void {
  // Первое соответствие выигрывает: обычно это основной глиф, а не дубликат.
  if (char !== null && !codes.has(char)) codes.set(char, code)
}

function blocks(cmap: string, name: 'bfchar' | 'bfrange'): string[] {
  const result: string[] = []
  const re = new RegExp(`begin${name}([\\s\\S]*?)end${name}`, 'g')
  for (let m = re.exec(cmap); m !== null; m = re.exec(cmap)) result.push(m[1] ?? '')
  return result
}

/** Таблица «буква → код» из текста CMap ToUnicode. */
export function parseToUnicode(cmap: string): CharCodes {
  const codes: CharCodes = new Map()
  for (const block of blocks(cmap, 'bfchar')) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g
    for (let m = re.exec(block); m !== null; m = re.exec(block)) {
      addCode(codes, singleChar(m[2] ?? ''), (m[1] ?? '').toLowerCase())
    }
  }
  for (const block of blocks(cmap, 'bfrange')) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g
    for (let m = re.exec(block); m !== null; m = re.exec(block)) {
      const loHex = m[1] ?? ''
      const lo = Number.parseInt(loHex, 16)
      const hi = Number.parseInt(m[2] ?? '', 16)
      const width = loHex.length
      if (Number.isNaN(lo) || Number.isNaN(hi) || hi < lo || hi - lo > 0xffff) continue
      const code = (n: number): string => n.toString(16).padStart(width, '0')
      if (m[4] !== undefined) {
        const targets = [...m[4].matchAll(/<([0-9a-fA-F]*)>/g)].map((t) => t[1] ?? '')
        targets.forEach((target, i) => {
          if (lo + i <= hi) addCode(codes, singleChar(target), code(lo + i))
        })
      } else {
        // Диапазон увеличивает последний UTF-16-код назначения на единицу.
        const start = m[3] ?? ''
        const base = Number.parseInt(start.slice(-4), 16)
        if (start.length < 4 || Number.isNaN(base)) continue
        for (let n = lo; n <= hi; n += 1) {
          const unit = (base + (n - lo)).toString(16).padStart(4, '0')
          addCode(codes, singleChar(start.slice(0, -4) + unit), code(n))
        }
      }
    }
  }
  return codes
}

/** Имя шрифта без префикса подмножества (ABCDEF+). */
export function fontFamily(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '')
}

/**
 * Одно ли это семейство. MuPDF обрезает имя шрифта до 31 символа, поэтому
 * полное имя из PDF сравнивается с обрезанным по началу.
 */
export function sameFamily(a: string, b: string): boolean {
  const x = fontFamily(a)
  const y = fontFamily(b)
  if (x.length === 0 || y.length === 0) return false
  // Обрезано всё имя вместе с префиксом подмножества.
  return x === y || (a.length >= 31 && y.startsWith(x)) || (b.length >= 31 && x.startsWith(y))
}
