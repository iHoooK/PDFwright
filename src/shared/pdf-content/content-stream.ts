import { concat, IDENTITY, type Matrix } from './geometry'

/**
 * Минимальный разбор потока содержимого страницы: ровно столько, чтобы найти
 * вызовы «/Имя Do» и текущую матрицу (CTM) в момент вызова. Нужен, чтобы убрать
 * конкретную картинку, не задевая соседние (redaction в MuPDF стирает всё, что
 * пересекает область).
 */

export interface XObjectCall {
  /** Имя ресурса без косой черты. */
  readonly name: string
  /** CTM в момент вызова: переводит единичный квадрат картинки в пространство страницы. */
  readonly ctm: Matrix
  /** Байтовый диапазон «/Имя Do» в потоке, конец не включается. */
  readonly start: number
  readonly end: number
}

type Token =
  | { kind: 'number'; value: number; start: number; end: number }
  | { kind: 'name'; value: string; start: number; end: number }
  | { kind: 'operator'; value: string; start: number; end: number }
  | { kind: 'other'; start: number; end: number }

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])

function isRegular(byte: number): boolean {
  return !WHITESPACE.has(byte) && !DELIMITERS.has(byte)
}

function ascii(data: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let i = start; i < end; i += 1) out += String.fromCharCode(data[i] ?? 0)
  return out
}

/** Конец литеральной строки (…) с учётом вложенных скобок и экранирования. */
function skipLiteralString(data: Uint8Array, pos: number): number {
  let depth = 0
  for (let i = pos; i < data.length; i += 1) {
    const byte = data[i]
    if (byte === 0x5c) i += 1
    else if (byte === 0x28) depth += 1
    else if (byte === 0x29) {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return data.length
}

/** Пропускает данные встроенной картинки после ID до EI, отделённого пробелами. */
function skipInlineImage(data: Uint8Array, pos: number): number {
  for (let i = pos + 1; i + 1 < data.length; i += 1) {
    if (
      data[i] === 0x45 &&
      data[i + 1] === 0x49 &&
      WHITESPACE.has(data[i - 1] ?? 0) &&
      (i + 2 >= data.length || !isRegular(data[i + 2] ?? 0))
    ) {
      return i + 2
    }
  }
  return data.length
}

function* tokenize(data: Uint8Array): Generator<Token> {
  let pos = 0
  while (pos < data.length) {
    const byte = data[pos] ?? 0
    if (WHITESPACE.has(byte)) {
      pos += 1
    } else if (byte === 0x25) {
      while (pos < data.length && data[pos] !== 0x0a && data[pos] !== 0x0d) pos += 1
    } else if (byte === 0x2f) {
      const start = pos
      pos += 1
      while (pos < data.length && isRegular(data[pos] ?? 0)) pos += 1
      const raw = ascii(data, start + 1, pos)
      const value = raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      yield { kind: 'name', value, start, end: pos }
    } else if (byte === 0x28) {
      const start = pos
      pos = skipLiteralString(data, pos)
      yield { kind: 'other', start, end: pos }
    } else if (byte === 0x3c && data[pos + 1] === 0x3c) {
      yield { kind: 'other', start: pos, end: pos + 2 }
      pos += 2
    } else if (byte === 0x3e && data[pos + 1] === 0x3e) {
      yield { kind: 'other', start: pos, end: pos + 2 }
      pos += 2
    } else if (byte === 0x3c) {
      const start = pos
      while (pos < data.length && data[pos] !== 0x3e) pos += 1
      pos += 1
      yield { kind: 'other', start, end: pos }
    } else if (DELIMITERS.has(byte)) {
      yield { kind: 'other', start: pos, end: pos + 1 }
      pos += 1
    } else {
      const start = pos
      while (pos < data.length && isRegular(data[pos] ?? 0)) pos += 1
      const word = ascii(data, start, pos)
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
        yield { kind: 'number', value: Number(word), start, end: pos }
      } else {
        yield { kind: 'operator', value: word, start, end: pos }
        if (word === 'ID') pos = skipInlineImage(data, pos)
      }
    }
  }
}

/** Все вызовы «/Имя Do» верхнего уровня потока с CTM относительно пространства страницы. */
export function findXObjectCalls(data: Uint8Array): XObjectCall[] {
  const calls: XObjectCall[] = []
  const stack: Matrix[] = []
  let ctm: Matrix = [...IDENTITY]
  let operands: Token[] = []
  for (const token of tokenize(data)) {
    if (token.kind !== 'operator') {
      operands.push(token)
      continue
    }
    if (token.value === 'q') {
      stack.push(ctm)
    } else if (token.value === 'Q') {
      ctm = stack.pop() ?? [...IDENTITY]
    } else if (token.value === 'cm') {
      const numbers = operands.slice(-6).flatMap((t) => (t.kind === 'number' ? [t.value] : []))
      if (numbers.length === 6) ctm = concat(numbers as Matrix, ctm)
    } else if (token.value === 'Do') {
      const name = operands.at(-1)
      if (name?.kind === 'name') {
        calls.push({ name: name.value, ctm, start: name.start, end: token.end })
      }
    }
    operands = []
  }
  return calls
}

/** Копия потока, где указанные диапазоны заменены пробелами (длина и остальные смещения сохраняются). */
export function blankRanges(
  data: Uint8Array,
  ranges: readonly { start: number; end: number }[]
): Uint8Array {
  const out = data.slice()
  for (const { start, end } of ranges) out.fill(0x20, start, end)
  return out
}
