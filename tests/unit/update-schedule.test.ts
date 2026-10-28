import { describe, expect, it, vi } from 'vitest'
import type { UpdateAvailable, UpdateCheckResult } from '@shared/ipc-contract'
import {
  UPDATE_CHECK_DELAY,
  UPDATE_CHECK_INTERVAL,
  UpdateSchedule
} from '../../src/main/update-schedule'

const available = (version: string): UpdateCheckResult => ({
  status: 'available',
  canInstall: true,
  info: {
    version,
    releaseDate: null,
    releaseNotes: null,
    size: 1000,
    page: `https://github.com/iHoooK/PDFwright/releases/tag/v${version}`
  }
})

function schedule(results: (UpdateCheckResult | Error)[], enabled = true) {
  const notified: UpdateAvailable[] = []
  const check = vi.fn(() => {
    const next = results.shift()
    if (!next) return Promise.resolve<UpdateCheckResult>({ status: 'none', current: '1.0.0' })
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  })
  const runner = new UpdateSchedule({
    enabled: () => enabled,
    check,
    notify: (update) => {
      notified.push(update)
    }
  })
  return { runner, check, notified }
}

describe('автоматическая проверка обновлений', () => {
  it('новая версия — одно предупреждение, та же версия повторно не предупреждает', async () => {
    const { runner, notified } = schedule([available('1.0.1'), available('1.0.1')])
    await runner.run()
    await runner.run()
    expect(notified.map((u) => u.info.version)).toEqual(['1.0.1'])
    expect(runner.pending?.info.version).toBe('1.0.1')
  })

  it('выключенная проверка не обращается к GitHub', async () => {
    const { runner, check, notified } = schedule([available('1.0.1')], false)
    await runner.run()
    expect(check).not.toHaveBeenCalled()
    expect(notified).toHaveLength(0)
  })

  it('ошибка сети не показывается, нет новой версии — нечего предлагать', async () => {
    const { runner, notified } = schedule([new Error('net::ERR_INTERNET_DISCONNECTED')])
    await runner.run()
    expect(notified).toHaveLength(0)
    expect(runner.pending).toBeNull()
    await runner.run()
    expect(runner.pending).toBeNull()
  })

  it('проверяет вскоре после запуска и раз в 12 часов', () => {
    const later = vi.fn()
    const every = vi.fn()
    new UpdateSchedule({
      enabled: () => true,
      check: () => Promise.resolve({ status: 'none', current: '1.0.0' }),
      notify: () => undefined,
      setTimeout: later,
      setInterval: every
    }).start()
    expect(later).toHaveBeenCalledWith(expect.any(Function), UPDATE_CHECK_DELAY)
    expect(every).toHaveBeenCalledWith(expect.any(Function), UPDATE_CHECK_INTERVAL)
    expect(UPDATE_CHECK_INTERVAL).toBe(12 * 60 * 60 * 1000)
  })
})
