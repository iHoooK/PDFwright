import type * as MupdfModule from 'mupdf'

export type Mupdf = typeof MupdfModule

let loading: Promise<Mupdf> | null = null

/**
 * Ленивая загрузка MuPDF: модуль тянет ~10 МБ WASM, поэтому подгружается при
 * первой операции, а не при старте программы. Работает в Node и в Web Worker.
 * Файл mupdf-wasm.wasm MuPDF ищет рядом со своим модулем
 * (new URL('mupdf-wasm.wasm', import.meta.url)): в Node это node_modules/mupdf/dist,
 * в сборке Vite кладёт его в out/renderer/assets/ и подставляет адрес с хешем,
 * и worker грузит его по app://renderer/assets/.
 */
export function loadMupdf(): Promise<Mupdf> {
  loading ??= import('mupdf').catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}
