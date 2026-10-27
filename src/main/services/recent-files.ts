import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { RecentFile } from '@shared/ipc-contract'
import { RECENT_LIMIT_MAX } from '@shared/settings-schema'
import { isMissingFile, writeAtomic } from './fs-utils'

/**
 * Список недавних файлов: только пути, время открытия и число страниц, без
 * содержимого (см. PRIVACY.md). Хранится в userData/recent.json.
 */
export class RecentFilesStore {
  private items: RecentFile[] = []
  private loaded = false
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly limit: () => number
  ) {}

  static forUserData(userDataPath: string, limit: () => number): RecentFilesStore {
    return new RecentFilesStore(join(userDataPath, 'recent.json'), limit)
  }

  async load(): Promise<RecentFile[]> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      this.items = normalizeRecent(raw)
    } catch (error) {
      if (!isMissingFile(error)) console.warn('[recent] файл повреждён, список очищен:', error)
      this.items = []
    }
    this.loaded = true
    return this.items
  }

  async list(): Promise<RecentFile[]> {
    if (!this.loaded) await this.load()
    return this.items
  }

  /** Поднимает файл в начало списка; без pages число страниц остаётся прежним. */
  async touch(path: string, pages?: number): Promise<RecentFile[]> {
    if (!this.loaded) await this.load()
    const known = pages ?? this.items.find((i) => i.path === path)?.pages
    const entry: RecentFile = {
      path,
      name: basename(path),
      lastOpenedMs: Date.now(),
      ...(known === undefined ? {} : { pages: known })
    }
    this.items = [entry, ...this.items.filter((i) => i.path !== path)].slice(0, this.limit())
    await this.persist()
    return this.items
  }

  async remove(path: string): Promise<RecentFile[]> {
    if (!this.loaded) await this.load()
    this.items = this.items.filter((i) => i.path !== path)
    await this.persist()
    return this.items
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.items, null, 2) + '\n'
    this.queue = this.queue.catch(() => undefined).then(() => writeAtomic(this.filePath, snapshot))
    return this.queue
  }
}

export function normalizeRecent(raw: unknown): RecentFile[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const result: RecentFile[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { path, lastOpenedMs, pages } = item as {
      path?: unknown
      lastOpenedMs?: unknown
      pages?: unknown
    }
    if (typeof path !== 'string' || path.length === 0 || seen.has(path)) continue
    seen.add(path)
    result.push({
      path,
      name: basename(path),
      lastOpenedMs:
        typeof lastOpenedMs === 'number' && Number.isFinite(lastOpenedMs) ? lastOpenedMs : 0,
      ...(typeof pages === 'number' && Number.isInteger(pages) && pages > 0 ? { pages } : {})
    })
    if (result.length >= RECENT_LIMIT_MAX) break
  }
  return result
}
