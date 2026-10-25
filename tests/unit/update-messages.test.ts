import { describe, expect, it } from 'vitest'
import { describeUpdateError, formatBytes } from '@shared/update-messages'

describe('describeUpdateError', () => {
  it('распознаёт сетевые ошибки, отсутствие релиза и лимиты', () => {
    expect(describeUpdateError(new Error('getaddrinfo ENOTFOUND github.com'))).toMatch(/интернет/)
    expect(describeUpdateError(new Error('HttpError: 404 Not Found'))).toMatch(/не найден/)
    expect(describeUpdateError(new Error('HttpError: 403 rate limit exceeded'))).toMatch(
      /ограничил/
    )
    expect(describeUpdateError(new Error('sha512 checksum mismatch'))).toMatch(/контрольной суммы/)
  })

  it('отмену и dev-режим описывает отдельно, остальное — с коротким текстом', () => {
    const cancel = new Error('cancelled')
    cancel.name = 'CancellationError'
    expect(describeUpdateError(cancel)).toBe('Скачивание отменено.')
    expect(
      describeUpdateError(new Error('Skip checkForUpdates because application is not packed'))
    ).toMatch(/portable/)
    expect(describeUpdateError(new Error('x'.repeat(300)))).toHaveLength(
      'Обновление не выполнено: '.length + 161
    )
  })
})

describe('formatBytes', () => {
  it('округляет до КБ и МБ', () => {
    expect(formatBytes(512)).toBe('1 КБ')
    expect(formatBytes(123_236_147)).toBe('117.5 МБ')
  })
})
