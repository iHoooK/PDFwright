/**
 * Попиксельная разница двух растров страницы. Растр — RGBA-массив с шириной
 * и высотой (как ImageData), поэтому функции работают и в Node без canvas.
 * Растры разного размера сравниваются в общей рамке: недостающая часть — белая
 * бумага. Сглаживание краёв не считается отличием: пиксель отличается, только
 * если такого же цвета нет рядом (в пределах tolerance) в другой версии.
 */

export interface Raster {
  readonly width: number
  readonly height: number
  /** RGBA построчно, 4 байта на пиксель. */
  readonly data: Uint8ClampedArray | Uint8Array
}

/** Прямоугольник в пикселях растра, начало — левый верхний угол. */
export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** Значения маски отличий. */
export const MASK_SAME = 0
/** Темнее в первой версии: содержимое удалено. */
export const MASK_REMOVED = 1
/** Темнее во второй версии: содержимое добавлено. */
export const MASK_ADDED = 2

export interface PixelDiffOptions {
  /** Наибольшая разница канала (0..255), которая ещё считается совпадением. */
  threshold?: number
  /** Допустимый сдвиг краёв из-за сглаживания, пикселей. */
  tolerance?: number
  /** Сторона ячейки, по которой отличия собираются в области, пикселей. */
  cell?: number
  /** Области, где отличающихся пикселей меньше, отбрасываются как шум. */
  minPixels?: number
}

export interface PixelDiff {
  width: number
  height: number
  /** MASK_SAME / MASK_REMOVED / MASK_ADDED на каждый пиксель общей рамки. */
  mask: Uint8Array
  /** Сколько пикселей отличается (после отбрасывания шума). */
  count: number
  /** Рамки областей отличий сверху вниз. */
  regions: PixelRect[]
}

const DEFAULTS: Required<PixelDiffOptions> = { threshold: 40, tolerance: 1, cell: 12, minPixels: 3 }

/** RGB поверх белой бумаги в общей рамке width × height. */
function flatten(raster: Raster, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3).fill(255)
  const { data } = raster
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4
      const d = (y * width + x) * 3
      const alpha = (data[s + 3] ?? 255) / 255
      const paper = 255 * (1 - alpha)
      out[d] = Math.round((data[s] ?? 255) * alpha + paper)
      out[d + 1] = Math.round((data[s + 1] ?? 255) * alpha + paper)
      out[d + 2] = Math.round((data[s + 2] ?? 255) * alpha + paper)
    }
  }
  return out
}

export function diffRasters(a: Raster, b: Raster, options: PixelDiffOptions = {}): PixelDiff {
  const { threshold, tolerance, cell, minPixels } = { ...DEFAULTS, ...options }
  const width = Math.max(a.width, b.width)
  const height = Math.max(a.height, b.height)
  const pa = flatten(a, width, height)
  const pb = flatten(b, width, height)
  const mask = new Uint8Array(width * height)

  const close = (p: Uint8Array, i: number, q: Uint8Array, j: number): boolean =>
    Math.abs((p[i] ?? 0) - (q[j] ?? 0)) <= threshold &&
    Math.abs((p[i + 1] ?? 0) - (q[j + 1] ?? 0)) <= threshold &&
    Math.abs((p[i + 2] ?? 0) - (q[j + 2] ?? 0)) <= threshold
  // Есть ли цвет пикселя (x, y) из p где-то рядом в q.
  const near = (p: Uint8Array, q: Uint8Array, x: number, y: number): boolean => {
    const i = (y * width + x) * 3
    for (let dy = -tolerance; dy <= tolerance; dy += 1) {
      const ny = y + dy
      if (ny < 0 || ny >= height) continue
      for (let dx = -tolerance; dx <= tolerance; dx += 1) {
        const nx = x + dx
        if (nx < 0 || nx >= width) continue
        if (close(p, i, q, (ny * width + nx) * 3)) return true
      }
    }
    return false
  }
  const luma = (p: Uint8Array, i: number): number =>
    (p[i] ?? 0) * 0.299 + (p[i + 1] ?? 0) * 0.587 + (p[i + 2] ?? 0) * 0.114

  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const cellPixels = new Int32Array(cols * rows)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3
      if (close(pa, i, pb, i)) continue
      if (tolerance > 0 && near(pa, pb, x, y) && near(pb, pa, x, y)) continue
      mask[y * width + x] = luma(pa, i) < luma(pb, i) ? MASK_REMOVED : MASK_ADDED
      const c = Math.floor(y / cell) * cols + Math.floor(x / cell)
      cellPixels[c] = (cellPixels[c] ?? 0) + 1
    }
  }

  // Соседние ячейки с отличиями (8-связность) — одна область.
  const seen = new Uint8Array(cols * rows)
  const regions: PixelRect[] = []
  let count = 0
  for (let start = 0; start < cols * rows; start += 1) {
    if ((cellPixels[start] ?? 0) === 0 || seen[start]) continue
    const cells: number[] = []
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const c = stack.pop() ?? 0
      cells.push(c)
      const cx = c % cols
      const cy = Math.floor(c / cols)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
          const n = ny * cols + nx
          if ((cellPixels[n] ?? 0) > 0 && !seen[n]) {
            seen[n] = 1
            stack.push(n)
          }
        }
      }
    }
    const pixels = cells.reduce((sum, c) => sum + (cellPixels[c] ?? 0), 0)
    if (pixels < minPixels) {
      for (const c of cells) clearCell(mask, width, height, cell, c % cols, Math.floor(c / cols))
      continue
    }
    count += pixels
    regions.push(boundsOf(mask, width, height, cell, cols, cells))
  }
  regions.sort((p, q) => p.y - q.y || p.x - q.x)
  return { width, height, mask, count, regions }
}

function clearCell(
  mask: Uint8Array,
  width: number,
  height: number,
  cell: number,
  cx: number,
  cy: number
): void {
  for (let y = cy * cell; y < Math.min(height, (cy + 1) * cell); y += 1) {
    mask.fill(MASK_SAME, y * width + cx * cell, y * width + Math.min(width, (cx + 1) * cell))
  }
}

/** Точная рамка отличающихся пикселей в наборе ячеек. */
function boundsOf(
  mask: Uint8Array,
  width: number,
  height: number,
  cell: number,
  cols: number,
  cells: readonly number[]
): PixelRect {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (const c of cells) {
    const cx = c % cols
    const cy = Math.floor(c / cols)
    for (let y = cy * cell; y < Math.min(height, (cy + 1) * cell); y += 1) {
      for (let x = cx * cell; x < Math.min(width, (cx + 1) * cell); x += 1) {
        if (mask[y * width + x] === MASK_SAME) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}
