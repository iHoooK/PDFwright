/** Закладки документа: дерево pdf.js в плоский список для боковой панели. */

export interface OutlineEntry {
  title: string
  depth: number
  dest: string | unknown[] | null
}

/** Узел дерева закладок из `PDFDocumentProxy.getOutline()`. */
export interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items?: readonly OutlineNode[] | null
}

/** Глубже восьми уровней закладки не разворачиваются. */
const MAX_DEPTH = 8

/** Дерево закладок в плоский список с глубиной; null (закладок нет) — пустой список. */
export function flattenOutline(outline: readonly OutlineNode[] | null | undefined): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  const walk = (nodes: readonly OutlineNode[] | null | undefined, depth: number): void => {
    for (const node of nodes ?? []) {
      entries.push({ title: node.title, depth, dest: node.dest })
      if (depth < MAX_DEPTH) walk(node.items, depth + 1)
    }
  }
  walk(outline, 0)
  return entries
}
