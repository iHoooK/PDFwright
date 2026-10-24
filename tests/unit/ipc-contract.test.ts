import { describe, expect, it } from 'vitest'
import { IpcChannels } from '@shared/ipc-contract'

describe('IpcChannels', () => {
  it('имена каналов уникальны и следуют схеме "область:действие"', () => {
    const names = Object.values(IpcChannels)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+:[a-z-]+$/)
    }
  })
})
