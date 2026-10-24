import { describe, expect, it } from 'vitest'
import { parsePdfDate } from '@shared/pdf-date'

describe('parsePdfDate', () => {
  it('разбирает полную дату со смещением', () => {
    const date = parsePdfDate("D:20261024110200+03'00'")
    expect(date?.toISOString()).toBe('2026-10-24T08:02:00.000Z')
  })

  it('разбирает дату в UTC и без времени', () => {
    expect(parsePdfDate('D:20260101120000Z')?.toISOString()).toBe('2026-01-01T12:00:00.000Z')
    expect(parsePdfDate('D:20260315')?.toISOString()).toBe('2026-03-15T00:00:00.000Z')
  })

  it('возвращает null для мусора', () => {
    expect(parsePdfDate('')).toBeNull()
    expect(parsePdfDate(undefined)).toBeNull()
    expect(parsePdfDate('D:abcd')).toBeNull()
    expect(parsePdfDate(42)).toBeNull()
  })
})
