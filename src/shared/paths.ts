/**
 * Работа с путями в renderer без Node: достаточно для имён файлов
 * и папок рядом с исходником. Разделитель берётся из самого пути.
 */

export function separatorOf(path: string): string {
  return path.includes('\\') ? '\\' : '/'
}

export function dirnameOf(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return index <= 0 ? path : path.slice(0, index)
}

export function basenameOf(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return index === -1 ? path : path.slice(index + 1)
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}

export function joinPath(dir: string, name: string): string {
  const sep = separatorOf(dir)
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}

/** Убирает символы, недопустимые в именах файлов Windows. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- управляющие символы запрещены в именах файлов Windows
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'document'
}
