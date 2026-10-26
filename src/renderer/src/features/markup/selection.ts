import type { Point } from '@shared/markup/geometry'
import { hitTest, type MarkupObject } from '@shared/markup/model'
import { pickPageObject } from '@shared/pdf-content/hit-test'
import type { PageGraphic, PageImage, PageTextBlock, PageTextLine } from '@shared/pdf-content/types'

/** Абзац, строка, картинка или векторный контур самого документа (из MuPDF, `listPageObjects`). */
export type PageContentObject = PageTextLine | PageTextBlock | PageImage | PageGraphic

/**
 * Что выбрано.
 *
 * - `markup` — объект разметки, добавленный до сохранения (инструмент «Выделение»);
 * - `content` — строка текста или картинка самого документа (инструмент «Правка»,
 *   фаза 10). Объект хранится целиком: по его тексту и рамке движок находит
 *   строку или картинку повторно, а после любой правки байтов выбор снимается.
 *
 * Выбор, Delete и панель свойств работают через `SelectionTarget`, поэтому для
 * нового источника нужны только его hitTest, рамка и редактор в панели свойств.
 */
export type SelectionTarget =
  | { source: 'markup'; id: string }
  | { source: 'content'; id: string; page: number; object: PageContentObject }

/** Выбранный объект самого документа (инструмент «Правка»). */
export type ContentTarget = Extract<SelectionTarget, { source: 'content' }>

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

export function contentId(page: number, object: PageContentObject): string {
  return `${page}:${object.kind}:${object.index}`
}

/** Строки и картинки документа на странице (см. pickPageObject). */
export function contentSource(
  page: number,
  objects: readonly PageContentObject[]
): SelectionSource {
  return {
    id: 'content',
    hitTest: (at, point, tolerance) => {
      if (at !== page) return null
      const best = pickPageObject(objects, point, tolerance)
      return best ? { source: 'content', id: contentId(page, best), page, object: best } : null
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

/** id выбранного объекта разметки (или null, если выбрано другое). */
export function selectedMarkupId(target: SelectionTarget | null): string | null {
  return target?.source === 'markup' ? target.id : null
}
