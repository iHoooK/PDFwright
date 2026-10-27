import { describe, expect, it } from 'vitest'
import { FILE_MISSING_ERROR, isFileMissingError } from '@shared/ipc-contract'
import { flattenOutline } from '@renderer/pdf-engine/outline'
import { parseZoomInput, ZOOM_MAX, ZOOM_MIN } from '@renderer/features/viewer/zoom'
import { windowTitle } from '@renderer/app/window-title'

describe('flattenOutline', () => {
  it('документ без закладок: pdf.js отдаёт null — список пуст, без исключения', () => {
    expect(flattenOutline(null)).toEqual([])
    expect(flattenOutline(undefined)).toEqual([])
  })

  it('разворачивает дерево с глубиной', () => {
    expect(
      flattenOutline([
        { title: 'Глава 1', dest: 'c1', items: [{ title: '1.1', dest: [0], items: [] }] },
        { title: 'Глава 2', dest: null, items: null }
      ])
    ).toEqual([
      { title: 'Глава 1', depth: 0, dest: 'c1' },
      { title: '1.1', depth: 1, dest: [0] },
      { title: 'Глава 2', depth: 0, dest: null }
    ])
  })
})

describe('parseZoomInput', () => {
  it('понимает число с процентом, пробелом и запятой', () => {
    expect(parseZoomInput('150')).toBe(150)
    expect(parseZoomInput('150%')).toBe(150)
    expect(parseZoomInput(' 87,5 % ')).toBe(88)
  })

  it('приводит к пределам и отвергает не числа', () => {
    expect(parseZoomInput('5')).toBe(ZOOM_MIN)
    expect(parseZoomInput('5000')).toBe(ZOOM_MAX)
    expect(parseZoomInput('')).toBeNull()
    expect(parseZoomInput('abc')).toBeNull()
    expect(parseZoomInput('0')).toBeNull()
    expect(parseZoomInput('-50')).toBeNull()
  })
})

describe('windowTitle', () => {
  it('имя документа на экране и название программы', () => {
    expect(windowTitle('Договор.pdf')).toBe('Договор.pdf — PDFwright')
    expect(windowTitle(null)).toBe('PDFwright')
    expect(windowTitle('')).toBe('PDFwright')
  })
})

describe('isFileMissingError', () => {
  it('узнаёт пропавший файл по маркеру в тексте ошибки IPC', () => {
    const wrapped = new Error(
      `Error invoking remote method 'file:read': Error: ${FILE_MISSING_ERROR}`
    )
    expect(isFileMissingError(wrapped)).toBe(true)
    expect(isFileMissingError(new Error('ENOENT: no such file'))).toBe(false)
    expect(isFileMissingError('строка')).toBe(false)
  })
})
