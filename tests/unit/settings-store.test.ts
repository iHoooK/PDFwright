import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/services/settings-store'
import { createDefaultSettings } from '@shared/settings-schema'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pdfwright-settings-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('без файла отдаёт значения по умолчанию и не создаёт файл до первой записи', async () => {
    const store = SettingsStore.forUserData(dir)
    expect(await store.load()).toEqual(createDefaultSettings())
    await expect(readFile(store.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('переживает повреждённый JSON', async () => {
    const store = SettingsStore.forUserData(dir)
    await writeFile(store.path, '{ not json', 'utf8')
    expect(await store.load()).toEqual(createDefaultSettings())
  })

  it('записывает атомарно и читает обратно', async () => {
    const store = SettingsStore.forUserData(dir)
    await store.load()
    await store.update({ general: { theme: 'dark' }, window: { width: 1600 } })

    const reread = SettingsStore.forUserData(dir)
    const loaded = await reread.load()
    expect(loaded.general.theme).toBe('dark')
    expect(loaded.window.width).toBe(1600)

    const raw = await readFile(store.path, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(JSON.parse(raw)).toEqual(loaded)
  })

  it('последовательные update не теряют изменения', async () => {
    const store = SettingsStore.forUserData(dir)
    await store.load()
    await Promise.all([
      store.update({ general: { theme: 'light' } }),
      store.update({ files: { backupOnSave: true } }),
      store.update({ viewer: { scrollMode: 'spread' } })
    ])
    const loaded = await SettingsStore.forUserData(dir).load()
    expect(loaded.general.theme).toBe('light')
    expect(loaded.files.backupOnSave).toBe(true)
    expect(loaded.viewer.scrollMode).toBe('spread')
  })
})
