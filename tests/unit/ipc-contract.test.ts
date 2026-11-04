import { describe, expect, it } from 'vitest'
import {
  invokeErrorText,
  IpcChannels,
  isNoPrintersError,
  NO_PRINTERS_ERROR
} from '@shared/ipc-contract'

describe('ошибки из main', () => {
  const invoke = (message: string): Error =>
    new Error(`Error invoking remote method 'file:print': Error: ${message}`)

  it('нет принтеров узнаётся и после префикса Electron', () => {
    expect(isNoPrintersError(invoke(NO_PRINTERS_ERROR))).toBe(true)
    expect(isNoPrintersError(invoke('Printer is offline'))).toBe(false)
  })

  it('префикс Electron убирается, остальной текст не меняется', () => {
    expect(invokeErrorText(invoke('Printer is offline'))).toBe('Printer is offline')
    expect(invokeErrorText(new Error('Printer is offline'))).toBe('Printer is offline')
    expect(invokeErrorText('Printer is offline')).toBe('Printer is offline')
  })
})

describe('IpcChannels', () => {
  it('имена каналов уникальны и следуют схеме "область:действие"', () => {
    const names = Object.values(IpcChannels)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+:[a-z-]+$/)
    }
  })
})
