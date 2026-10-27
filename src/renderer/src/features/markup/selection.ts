import type { Point } from '@shared/markup/geometry'
import {
  hitInside,
  hitObject,
  hitTest,
  hitTestInside,
  type MarkupObject
} from '@shared/markup/model'
import type { PageAnnotation } from '@shared/pdf-content/annotations'
import { pickPageObject } from '@shared/pdf-content/hit-test'
import type { PageGraphic, PageImage, PageTextBlock, PageTextLine } from '@shared/pdf-content/types'
import { annotationId, annotationShape } from '@renderer/features/annotations/page-annotations'

/** Абзац, строка, картинка или векторный контур самого документа (из MuPDF, `listPageObjects`). */
export type PageContentObject = PageTextLine | PageTextBlock | PageImage | PageGraphic

/**
 * Что выбрано.
 *
 * - `markup` — объект разметки, добавленный до сохранения (инструмент «Выделение»);
 * - `content` — строка текста или картинка самого документа (инструмент «Правка»,
 *   фаза 10). Объект хранится целиком: по его тексту и рамке движок находит
 *   строку или картинку повторно, а после любой правки байтов выбор снимается.
 * - `annotation` — аннотация, которая уже есть в файле (инструмент «Выделение»,
 *   фаза 15): место в списке аннотаций страницы и тип. Сам объект берётся из
 *   списка для текущих байтов (loadAnnotations), поэтому выбор переживает правки.
 *
 * Выбор, Delete и панель свойств работают через `SelectionTarget`, поэтому для
 * нового источника нужны только его hitTest, рамка и редактор в панели свойств.
 */
export type SelectionTarget =
  | { source: 'markup'; id: string }
  | { source: 'content'; id: string; page: number; object: PageContentObject }
  | { source: 'annotation'; id: string; page: number; index: number; subtype: string }

/** Выбранный объект самого документа (инструмент «Правка»). */
export type ContentTarget = Extract<SelectionTarget, { source: 'content' }>

export interface SelectionSource {
  readonly id: SelectionTarget['source']
  /** Объект под точкой (координаты страницы, допуск в пунктах) или null. */
  hitTest: (page: number, point: Point, tolerance: number) => SelectionTarget | null
  /** Фигура, внутри которой точка (не на контуре), — второй проход hitSources. */
  hitInside?: (page: number, point: Point) => SelectionTarget | null
}

export function markupSource(objects: readonly MarkupObject[]): SelectionSource {
  return {
    id: 'markup',
    hitTest: (page, point, tolerance) => {
      const hit = hitTest(objects, page, point, tolerance)
      return hit ? { source: 'markup', id: hit.id } : null
    },
    hitInside: (page, point) => {
      const hit = hitTestInside(objects, page, point)
      return hit ? { source: 'markup', id: hit.id } : null
    }
  }
}

/** Аннотации документа на странице: верхняя (последняя в списке) выбирается первой. */
export function annotationSource(
  page: number,
  annotations: readonly PageAnnotation[]
): SelectionSource {
  return {
    id: 'annotation',
    hitTest: (at, point, tolerance) => {
      if (at !== page) return null
      for (let i = annotations.length - 1; i >= 0; i -= 1) {
        const a = annotations[i]
        if (a && hitObject(annotationShape(a, page), point, tolerance)) {
          return annotationTarget(page, a)
        }
      }
      return null
    },
    hitInside: (at, point) => {
      if (at !== page) return null
      for (let i = annotations.length - 1; i >= 0; i -= 1) {
        const a = annotations[i]
        if (a && hitInside(annotationShape(a, page), point)) return annotationTarget(page, a)
      }
      return null
    }
  }
}

export function annotationTarget(page: number, a: PageAnnotation): SelectionTarget {
  return {
    source: 'annotation',
    id: annotationId(page, a.index),
    page,
    index: a.index,
    subtype: a.subtype
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

/**
 * Опрос источников по порядку: разметка лежит поверх содержимого и выбирается
 * первой. Сначала — попадание по самим объектам (контуры, строки, рамки); если
 * мимо и inside разрешён (под указателем нет текста страницы), — щелчок внутри фигуры.
 */
export function hitSources(
  sources: readonly SelectionSource[],
  page: number,
  point: Point,
  tolerance: number,
  inside = false
): SelectionTarget | null {
  for (const source of sources) {
    const target = source.hitTest(page, point, tolerance)
    if (target) return target
  }
  if (!inside) return null
  for (const source of sources) {
    const target = source.hitInside?.(page, point) ?? null
    if (target) return target
  }
  return null
}

export function sameTarget(a: SelectionTarget | null, b: SelectionTarget | null): boolean {
  return a?.source === b?.source && a?.id === b?.id
}

export function hasTarget(list: readonly SelectionTarget[], target: SelectionTarget): boolean {
  return list.some((item) => sameTarget(item, target))
}

/** id выбранного объекта разметки (или null, если выбрано другое). */
export function selectedMarkupId(target: SelectionTarget | null): string | null {
  return target?.source === 'markup' ? target.id : null
}
