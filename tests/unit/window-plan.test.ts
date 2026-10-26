import { describe, expect, it } from 'vitest'
import {
  cascadeFrame,
  fitFrameToScreens,
  pickWindowForFile,
  planSessionRestore,
  samePath
} from '../../src/main/window-plan'
import type { SessionWindow } from '@shared/settings-schema'

describe('pickWindowForFile', () => {
  const windows = [
    { id: 1, lastActive: 5, tabs: ['C:\\docs\\a.pdf'] },
    { id: 2, lastActive: 9, tabs: [] },
    { id: 3, lastActive: 7, tabs: ['C:\\docs\\b.pdf', 'C:\\docs\\c.pdf'] }
  ]

  it('без окон некуда открывать', () => {
    expect(pickWindowForFile([], 'C:\\docs\\a.pdf')).toBeNull()
  })

  it('новый файл идёт в последнее активное окно', () => {
    expect(pickWindowForFile(windows, 'C:\\docs\\new.pdf')).toBe(2)
  })

  it('уже открытый файл идёт в окно, где он открыт, без учёта регистра и косых черт', () => {
    expect(pickWindowForFile(windows, 'c:/DOCS/a.pdf')).toBe(1)
    expect(pickWindowForFile(windows, 'C:\\docs\\c.pdf')).toBe(3)
  })

  it('из нескольких окон с файлом выбирает самое активное', () => {
    const both = [...windows, { id: 4, lastActive: 8, tabs: ['C:\\docs\\a.pdf'] }]
    expect(pickWindowForFile(both, 'C:\\docs\\a.pdf')).toBe(4)
  })

  it('samePath сравнивает пути Windows', () => {
    expect(samePath('C:\\A\\b.PDF', 'c:/a/B.pdf')).toBe(true)
    expect(samePath('C:\\a\\b.pdf', 'C:\\a\\c.pdf')).toBe(false)
  })
})

describe('fitFrameToScreens', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  const second = { x: 1920, y: 0, width: 1280, height: 984 }

  it('оставляет положение на видимом экране', () => {
    expect(
      fitFrameToScreens({ x: 2000, y: 100, width: 1000, height: 700 }, [primary, second])
    ).toEqual({ x: 2000, y: 100, width: 1000, height: 700 })
  })

  it('забывает положение на отключённом мониторе', () => {
    expect(fitFrameToScreens({ x: 2000, y: 100, width: 1000, height: 700 }, [primary])).toEqual({
      width: 1000,
      height: 700
    })
  })

  it('заголовок за верхним краем или едва виден — положение не сохраняется', () => {
    expect(fitFrameToScreens({ x: 100, y: -50, width: 1000, height: 700 }, [primary])).toEqual({
      width: 1000,
      height: 700
    })
    expect(fitFrameToScreens({ x: 1880, y: 100, width: 1000, height: 700 }, [primary])).toEqual({
      width: 1000,
      height: 700
    })
  })

  it('уменьшает окно до самого большого экрана', () => {
    expect(fitFrameToScreens({ x: null, y: null, width: 4000, height: 3000 }, [primary])).toEqual({
      width: 1920,
      height: 1040
    })
  })

  it('cascadeFrame сдвигает новое окно от исходного', () => {
    expect(cascadeFrame({ x: 10, y: 20, width: 1000, height: 700 })).toEqual({
      x: 38,
      y: 48,
      width: 1000,
      height: 700
    })
  })
})

describe('planSessionRestore', () => {
  const window = (tabs: string[], active: number): SessionWindow => ({
    x: 10,
    y: 10,
    width: 1200,
    height: 800,
    maximized: false,
    tabs,
    active
  })

  it('восстанавливает окна, вкладки и активную вкладку', () => {
    const plan = planSessionRestore([window(['C:\\a.pdf', 'C:\\b.pdf'], 1)], () => true)
    expect(plan.missing).toEqual([])
    expect(plan.windows).toEqual([
      {
        frame: { x: 10, y: 10, width: 1200, height: 800 },
        maximized: false,
        files: ['C:\\a.pdf', 'C:\\b.pdf'],
        active: 'C:\\b.pdf'
      }
    ])
  })

  it('пропускает отсутствующие файлы и окна, где не осталось ни одного', () => {
    const exists = (path: string): boolean => !path.includes('gone')
    const plan = planSessionRestore(
      [window(['C:\\gone1.pdf'], 0), window(['C:\\a.pdf', 'C:\\gone2.pdf', 'C:\\c.pdf'], 1)],
      exists
    )
    expect(plan.missing).toEqual(['C:\\gone1.pdf', 'C:\\gone2.pdf'])
    expect(plan.windows).toHaveLength(1)
    expect(plan.windows[0]?.files).toEqual(['C:\\a.pdf', 'C:\\c.pdf'])
    // Активный файл пропал — активной становится следующая вкладка.
    expect(plan.windows[0]?.active).toBe('C:\\c.pdf')
  })

  it('пропала последняя активная вкладка — активна предыдущая', () => {
    const plan = planSessionRestore([window(['C:\\a.pdf', 'C:\\gone.pdf'], 1)], (path) =>
      path.endsWith('a.pdf')
    )
    expect(plan.windows[0]?.active).toBe('C:\\a.pdf')
  })
})
