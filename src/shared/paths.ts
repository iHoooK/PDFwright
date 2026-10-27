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

/** «Папка\имя (n).pdf» для «Папка\имя.pdf»: так Проводник называет копии. */
export function numberedPath(path: string, n: number): string {
  const name = basenameOf(path)
  const dot = name.lastIndexOf('.')
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? '' : name.slice(dot)
  const numbered = `${stem} (${n})${ext}`
  return name === path ? numbered : joinPath(dirnameOf(path), numbered)
}

/**
 * Свободное имя файла: сам путь, если он не занят, иначе первый свободный
 * из «имя (2)», «имя (3)»… Имена в Windows не различают регистр, поэтому
 * taken получает путь в нижнем регистре.
 */
export function freePath(path: string, taken: (lowerCasePath: string) => boolean): string {
  if (!taken(path.toLowerCase())) return path
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = numberedPath(path, n)
    if (!taken(candidate.toLowerCase())) return candidate
  }
  throw new Error(`Нет свободного имени для ${basenameOf(path)}`)
}

/** Убирает символы, недопустимые в именах файлов Windows. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- управляющие символы запрещены в именах файлов Windows
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'document'
}
