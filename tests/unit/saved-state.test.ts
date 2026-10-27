import { describe, expect, it } from 'vitest'
import {
  matchesSaved,
  protectionWritten,
  sameForms,
  type SavedState
} from '@renderer/app/saved-state'
import {
  sameValue,
  supportsSelection,
  withFieldValue,
  withoutField
} from '@renderer/features/forms/form-values'

/** «Изменён» — текущий снимок вкладки не совпадает с записанным в файл. */
describe('saved-state', () => {
  const bytes = new Uint8Array([1, 2, 3])
  const protection = { kind: 'new' }
  const saved: SavedState<typeof protection> = { bytes, markup: [], forms: {}, protection: null }

  it('после отмены всех правок документ снова совпадает с файлом', () => {
    expect(matchesSaved({ bytes, markup: [], forms: {} }, saved)).toBe(true)
    // Другие байты (операция со страницами) — изменён, даже если похожи.
    expect(matchesSaved({ bytes: new Uint8Array([1, 2, 3]), markup: [], forms: {} }, saved)).toBe(
      false
    )
    expect(matchesSaved({ bytes, markup: [{ id: 'm1' }], forms: {} }, saved)).toBe(false)
    expect(matchesSaved({ bytes, markup: [], forms: { name: 'Иван' } }, saved)).toBe(false)
    expect(matchesSaved({ bytes, markup: [], forms: {}, protection }, saved)).toBe(false)
    // Новый документ, который ещё не сохранялся, всегда изменён.
    expect(matchesSaved({ bytes, markup: [], forms: {} }, undefined)).toBe(false)
  })

  it('значения полей сравниваются по содержимому', () => {
    expect(sameForms({ a: 'x', b: ['1', '2'] }, { b: ['1', '2'], a: 'x' })).toBe(true)
    expect(sameForms({ a: 'x' }, { a: 'y' })).toBe(false)
    expect(sameForms({ a: 'x' }, { a: 'x', b: 'Off' })).toBe(false)
    expect(sameForms({ b: ['1'] }, { b: ['1', '2'] })).toBe(false)
  })

  it('новая защита записана, если сохранение было с ней же', () => {
    expect(protectionWritten(protection, saved)).toBe(false)
    expect(protectionWritten(protection, { ...saved, protection })).toBe(true)
    expect(protectionWritten(protection, undefined)).toBe(false)
  })
})

describe('form-values', () => {
  it('поле, вернувшееся к значению из файла, убирается из несохранённых', () => {
    const values = { agree: 'Yes', name: 'Анна' }
    expect(withFieldValue(values, 'agree', null)).toEqual({ name: 'Анна' })
    expect(withFieldValue(values, 'name', 'Анна')).toBe(values)
    expect(withFieldValue(values, 'city', ['Kazan'])).toEqual({ ...values, city: ['Kazan'] })
    expect(withoutField(values, 'nope')).toBe(values)
    // Флажок переключён дважды: несохранённых значений не осталось.
    expect(withFieldValue(withFieldValue({}, 'agree', 'Yes'), 'agree', null)).toEqual({})
  })

  it('сравнение значений списков и строк', () => {
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameValue(['a'], 'a')).toBe(false)
    expect(sameValue('Off', 'Off')).toBe(true)
  })

  it('курсор ставится только в текстовые поля, не во флажки', () => {
    expect(supportsSelection('INPUT', 'text')).toBe(true)
    expect(supportsSelection('INPUT', 'password')).toBe(true)
    expect(supportsSelection('TEXTAREA', '')).toBe(true)
    expect(supportsSelection('INPUT', 'checkbox')).toBe(false)
    expect(supportsSelection('INPUT', 'radio')).toBe(false)
    expect(supportsSelection('SELECT', 'select-one')).toBe(false)
  })
})
