import {
  boxContentSize,
  normalizeTurn,
  transformRect,
  type Matrix,
  type PageGeometry
} from '@shared/markup/geometry'
import type { ImageObject, TextObject } from '@shared/markup/model'
import type { Rotation } from '@renderer/pdf-engine/engine'

/** Где на экране стоит коробка текста или картинки: рамка вида, размер содержимого и поворот. */
export interface BoxPlacement {
  frame: { x: number; y: number; width: number; height: number }
  width: number
  height: number
  turn: number
}

export function boxPlacement(
  o: TextObject | ImageObject,
  matrix: Matrix,
  geometry: PageGeometry,
  rotation: Rotation,
  scale: number
): BoxPlacement {
  const content = boxContentSize(o.rect, o.rotate)
  return {
    frame: transformRect(matrix, o.rect),
    width: content.width * scale,
    height: content.height * scale,
    turn: normalizeTurn(geometry.rotate + rotation - o.rotate)
  }
}
