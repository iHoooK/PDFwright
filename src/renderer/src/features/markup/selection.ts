import type { Point } from '@shared/markup/geometry'
import { hitTest, type MarkupObject } from '@shared/markup/model'

/**
 * Что выбрано инструментом «Выделение».
 *
 * Сейчас источник один — `markup`: объекты разметки, добавленные до
 * сохранения. Точка расширения для фазы 10 (правка содержимого на MuPDF):
 * сделать `SelectionTarget` объединением с вариантом
 * `{ source: 'content'; page: number; id: string; object: PageContentObject }`
 * для строк текста и картинок самого документа (`listPageObjects`) и источник
 * `SelectionSource` с id `content`, который MarkupLayer получит в списке
 * источников после разметки. Выбор, рамка при наведении, Delete и панель
 * свойств работают через `SelectionTarget`, поэтому для нового источника
 * нужны только его hitTest, рамка (`bounds`) и редактор в панели свойств.
 */
export interface SelectionTarget {
  source: 'markup'
  id: string
}

export interface SelectionSource {
  readonly id: SelectionTarget['source']
  /** Объект под точкой (координаты страницы, допуск в пунктах) или null. */
  hitTest: (page: number, point: Point, tolerance: number) => SelectionTarget | null
}

export function markupSource(objects: readonly MarkupObject[]): SelectionSource {
  return {
    id: 'markup',
    hitTest: (page, point, tolerance) => {
      const hit = hitTest(objects, page, point, tolerance)
      return hit ? { source: 'markup', id: hit.id } : null
    }
  }
}

/** Опрос источников по порядку: разметка лежит поверх содержимого и выбирается первой. */
export function hitSources(
  sources: readonly SelectionSource[],
  page: number,
  point: Point,
  tolerance: number
): SelectionTarget | null {
  for (const source of sources) {
    const target = source.hitTest(page, point, tolerance)
    if (target) return target
  }
  return null
}

export function sameTarget(a: SelectionTarget | null, b: SelectionTarget | null): boolean {
  return a?.source === b?.source && a?.id === b?.id
}
