# mac/prep/arm64

- Коммит: `ff3e96c` M0: эталон Windows, сравнение снимков и итоги проверки на Mac
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/40938618771 (попытка 1)
- Машина: macOS 26.6.2 (arm64), Node 24.21.0, Electron 45.0.0
- Время: 2026-10-29 19:24 UTC
- Итог: упали unit, e2e

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 37 с |  | `npm ci` |
| lint | ✅ прошёл | 31 с |  | `npm run lint` |
| typecheck | ✅ прошёл | 11 с |  | `npm run typecheck` |
| unit | ❌ упал (код 1) | 12 с | 5 failed · 283 passed (288) | `npm test` |
| build | ✅ прошёл | 2 с |  | `npm run build` |
| e2e | ❌ упал (код 1) | 4 мин 29 с | 1 failed · 43 passed (44) | `npm run test:e2e` |
| package | ✅ прошёл | 12 с |  | `npx electron-builder --mac --dir --arm64 --publish never` |
| app-info | ✅ прошёл | 0 с |  | `sh -c du -sh "$0"; plutil -p "$0/Contents/Info.plist"; codesign -dv "$0" 2>&1 \|\| true build/mac-arm64/PDFwright.app` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

## unit: ошибки

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/app-paths.test.ts > isPortableBuild > узнаёт portable по файлу-маркеру рядом с exe
AssertionError: expected 'PDFwright.portable' to be 'C:\Apps\PDFwright\PDFwright.portable' // Object.is equality

Expected: "C:\Apps\PDFwright\PDFwright.portable"
Received: "PDFwright.portable"

 ❯ tests/unit/app-paths.test.ts:18:21
     16|     }
     17|     expect(isPortableBuild({}, exe, exists)).toBe(true)
     18|     expect(seen[0]).toBe(`C:\\Apps\\PDFwright\\${PORTABLE_MARKER}`)
       |                     ^
     19|   })
     20|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/5]⎯

 FAIL  tests/unit/main-helpers.test.ts > extractPdfPaths > берёт .pdf-аргумент и разрешает относительный путь
AssertionError: expected [ Array(1) ] to deeply equal [ 'C:\docs\a.pdf' ]

- Expected
+ Received

  [
-   "C:\\docs\\a.pdf",
+   "/Users/runner/work/PDFwright/PDFwright/D:\\work/C:\\docs\\a.pdf",
  ]

 ❯ tests/unit/main-helpers.test.ts:13:66
     11|
     12|   it('берёт .pdf-аргумент и разрешает относительный путь', () => {
     13|     expect(extractPdfPaths(['app.exe', 'C:\\docs\\a.pdf'], cwd)).toEqu…
       |                                                                  ^
     14|     expect(extractPdfPaths(['app.exe', 'b.PDF'], cwd)).toEqual([resolv…
     15|   })

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/5]⎯

 FAIL  tests/unit/main-helpers.test.ts > extractPdfPaths > отдаёт все PDF по порядку без повторов: несколько файлов, брошенных на ярлык
AssertionError: expected [ …(2) ] to deeply equal [ 'C:\a.pdf', …(1) ]

- Expected
+ Received

  [
-   "C:\\a.pdf",
+   "/Users/runner/work/PDFwright/PDFwright/D:\\work/C:\\a.pdf",
    "/Users/runner/work/PDFwright/PDFwright/D:\\work/b.pdf",
  ]

 ❯ tests/unit/main-helpers.test.ts:20:7
     18|     expect(
     19|       extractPdfPaths(['app.exe', 'C:\\a.pdf', '--flag', 'notes.txt', …
     20|     ).toEqual(['C:\\a.pdf', resolve(cwd, 'b.pdf')])
       |       ^
     21|   })
     22|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/5]⎯

 FAIL  tests/unit/main-helpers.test.ts > normalizeRecent > отбрасывает мусор и дубликаты
AssertionError: expected [ { path: 'C:\a.pdf', …(2) }, …(1) ] to deeply equal [ { path: 'C:\a.pdf', …(2) }, …(1) ]

- Expected
+ Received

  [
    {
      "lastOpenedMs": 5,
-     "name": "a.pdf",
+     "name": "C:\\a.pdf",
      "path": "C:\\a.pdf",
    },
    {
      "lastOpenedMs": 0,
-     "name": "b.pdf",
+     "name": "C:\\b.pdf",
      "path": "C:\\b.pdf",
    },
  ]

 ❯ tests/unit/main-helpers.test.ts:58:20
     56|       { path: 'C:\\b.pdf', lastOpenedMs: 'x' }
     57|     ])
     58|     expect(result).toEqual([
       |                    ^
     59|       { path: 'C:\\a.pdf', name: 'a.pdf', lastOpenedMs: 5 },
     60|       { path: 'C:\\b.pdf', name: 'b.pdf', lastOpenedMs: 0 }

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/5]⎯

 FAIL  tests/unit/main-helpers.test.ts > RecentFilesStore > добавляет в начало, обрезает по лимиту и сохраняет на диск
AssertionError: expected [ 'C:\three.pdf', 'C:\two.pdf' ] to deeply equal [ 'three.pdf', 'two.pdf' ]

- Expected
+ Received

  [
-   "three.pdf",
-   "two.pdf",
+   "C:\\three.pdf",
+   "C:\\two.pdf",
  ]

 ❯ tests/unit/main-helpers.test.ts:80:37
     78|     await store.touch('C:\\three.pdf')
     79|     const list = await store.list()
     80|     expect(list.map((i) => i.name)).toEqual(['three.pdf', 'two.pdf'])
       |                                     ^
     81|
     82|     const reloaded = await RecentFilesStore.forUserData(dir, () => 2).…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯


 Test Files  2 failed | 30 passed (32)
      Tests  5 failed | 283 passed (288)
   Start at  19:19:46
   Duration  11.25s (tests 78%, import 14%, transform 7%, worker 1%)

    Isolate  32 workers spawned · ~138ms startup each (spawn + environment, per file)
             at least ~2.07s faster with isolate: false — reuses workers across files instead of one per file


::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/app-paths.test.ts,title=tests/unit/app-paths.test.ts > isPortableBuild > узнаёт portable по файлу-маркеру рядом с exe,line=18,column=21::AssertionError: expected 'PDFwright.portable' to be 'C:\Apps\PDFwright\PDFwright.portable' // Object…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/main-helpers.test.ts,title=tests/unit/main-helpers.test.ts > extractPdfPaths > берёт .pdf-аргумент и разрешает относительный путь,line=13,column=66::AssertionError: expected [ Array(1) ] to deeply equal [ 'C:\docs\a.pdf' ]%0A%0A- Expecte…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/main-helpers.test.ts,title=tests/unit/main-helpers.test.ts > extractPdfPaths > отдаёт все PDF по порядку без повторов%3A несколько файлов%2C брошенных на ярлык,line=20,column=7::AssertionError: expected [ …(2) ] to deeply equal [ 'C:\a.p…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/main-helpers.test.ts,title=tests/unit/main-helpers.test.ts > normalizeRecent > отбрасывает мусор и дубликаты,line=58,column=20::AssertionError: expected [ { path: 'C:\a.pdf', …(2) }, …(1) ] to deeply equal [ { path: 'C:\a.pdf', …(2) }, ……

::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/main-helpers.test.ts,title=tests/unit/main-helpers.test.ts > RecentFilesStore > добавляет в начало%2C обрезает по лимиту и сохраняет на диск,line=80,column=37::AssertionError: expected [ 'C:\three.pdf', 'C:\two.pdf' ] to deeply equal [ '…
```

Полный вывод: [logs/unit.log](logs/unit.log)

## e2e: ошибки

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/e2e/protect.e2e.ts > Защита паролем (собранное приложение) > смена пароля на открытие сохраняет пароль владельца и запреты; запреты действуют в программе
TimeoutError: locator.waitFor: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('status').filter({ hasText: 'запретил копирование' }) to be visible

 ❯ tests/e2e/protect.e2e.ts:217:61
    215|     await page.keyboard.press('Control+a')
    216|     await page.keyboard.press('Control+c')
    217|     await toast.filter({ hasText: 'запретил копирование' }).waitFor()
       |                                                             ^
    218|     expect(await requireApp().evaluate(({ clipboard }) => clipboard.re…
    219|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 13 passed (14)
      Tests  1 failed | 43 passed (44)
   Start at  19:20:01
   Duration  268.25s (tests 96%, import 3%)


::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/protect.e2e.ts,title=tests/e2e/protect.e2e.ts > Защита паролем (собранное приложение) > смена пароля на открытие сохраняет пароль владельца и запреты; запреты действуют в программе,line=217,column=61::TimeoutError: locator.waitFor: Timeou…
```

Полный вывод: [logs/e2e.log](logs/e2e.log)

## Файлы

- [app-files.txt](app-files.txt)

## Снимки (33)

- [annotations-edited.png](shots/annotations-edited.png)
- [annotations-group.png](shots/annotations-group.png)
- [annotations-thumbs.png](shots/annotations-thumbs.png)
- [compare-columns.png](shots/compare-columns.png)
- [compare-overlay.png](shots/compare-overlay.png)
- [content-group.png](shots/content-group.png)
- [content-replaced.png](shots/content-replaced.png)
- [content-resized.png](shots/content-resized.png)
- [convert-compress.png](shots/convert-compress.png)
- [convert-from-images.png](shots/convert-from-images.png)
- [convert-to-images.png](shots/convert-to-images.png)
- [english.png](shots/english.png)
- [forms-filled.png](shots/forms-filled.png)
- [forms-metadata.png](shots/forms-metadata.png)
- [markup-annotations.png](shots/markup-annotations.png)
- [markup-flatten.png](shots/markup-flatten.png)
- [markup-resize.png](shots/markup-resize.png)
- [markup-signature.png](shots/markup-signature.png)
- [ocr-dialog.png](shots/ocr-dialog.png)
- [ocr-done.png](shots/ocr-done.png)
- [ocr-selected.png](shots/ocr-selected.png)
- [protect-dialog.png](shots/protect-dialog.png)
- [qa-licenses.png](shots/qa-licenses.png)
- [qa-marker-rotated.png](shots/qa-marker-rotated.png)
- [qa-ocr-warning.png](shots/qa-ocr-warning.png)
- [qa-pages-all-selected.png](shots/qa-pages-all-selected.png)
- [qa-properties-small.png](shots/qa-properties-small.png)
- [qa-recent-missing.png](shots/qa-recent-missing.png)
- [qa-shapes.png](shots/qa-shapes.png)
- [qa-zoom-menu.png](shots/qa-zoom-menu.png)
- [update-notice.png](shots/update-notice.png)
- [update-settings.png](shots/update-settings.png)
- [windows-tab-menu.png](shots/windows-tab-menu.png)
