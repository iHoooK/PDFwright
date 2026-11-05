# mac/app/x64

- Коммит: `4b8b3da` План: M1 выполнена — статусы, сводки и итог проверок
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/40945070400 (попытка 1)
- Машина: macOS 15.7.9 (x64), Node 24.19.0, Electron 45.0.0
- Время: 2026-10-29 20:11 UTC
- Итог: упали unit, e2e

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 1 мин 45 с |  | `npm ci` |
| lint | ✅ прошёл | 1 мин 6 с |  | `npm run lint` |
| typecheck | ✅ прошёл | 20 с |  | `npm run typecheck` |
| unit | ❌ упал (код 1) | 29 с | 6 failed · 314 passed (320) | `npm test` |
| build | ✅ прошёл | 5 с |  | `npm run build` |
| e2e | ❌ упал (код 1) | 7 мин 1 с | 4 failed · 47 passed (51) | `npm run test:e2e` |
| package | ✅ прошёл | 19 с |  | `npx electron-builder --mac --dir --x64 --publish never` |
| app-info | ✅ прошёл | 0 с |  | `sh -c du -sh "$0"; plutil -p "$0/Contents/Info.plist"; codesign -dv "$0" 2>&1 \|\| true build/mac/PDFwright.app` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

## unit: ошибки

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  tests/unit/convert.test.ts > изображения в PDF > десять фотографий складываются в документ быстро и в заданном порядке
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ tests/unit/convert.test.ts:245:3
    243|   })
    244|
    245|   it('десять фотографий складываются в документ быстро и в заданном по…
       |   ^
    246|     const photos = Array.from({ length: 10 }, (_, i) => {
    247|       const pixmap = photo(i % 2 === 0 ? 1600 : 1200, i % 2 === 0 ? 12…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/6]⎯


 Test Files  3 failed | 33 passed (36)
      Tests  6 failed | 314 passed (320)
   Start at  20:03:42
   Duration  26.99s (tests 75%, import 15%, transform 9%, worker 1%)

    Isolate  36 workers spawned · ~397ms startup each (spawn + environment, per file)
             at least ~4.37s faster with isolate: false — reuses workers across files instead of one per file


::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/app-paths.test.ts,title=tests/unit/app-paths.test.ts > isPortableBuild > узнаёт portable по файлу-маркеру рядом с exe,line=18,column=21::AssertionError: expected 'PDFwright.portable' to be 'C:\Apps\PDFwright\PDFwright.portable' // Object…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/convert.test.ts,title=tests/unit/convert.test.ts > изображения в PDF > десять фотографий складываются в документ быстро и в заданном порядке,line=245,column=3::Error: Test timed out in 5000ms.%0AIf this is a long-running test, pass a tim…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/main-helpers.test.ts,title=tests/unit/main-helpers.test.ts > extractPdfPaths > берёт .pdf-аргумент и разрешает относительный путь,line=13,column=66::AssertionError: expected [ Array(1) ] to deeply equal [ 'C:\docs\a.pdf' ]%0A%0A- Expecte…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/main-helpers.test.ts,title=tests/unit/main-helpers.test.ts > extractPdfPaths > отдаёт все PDF по порядку без повторов%3A несколько файлов%2C брошенных на ярлык,line=20,column=7::AssertionError: expected [ …(2) ] to deeply equal [ 'C:\a.p…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/main-helpers.test.ts,title=tests/unit/main-helpers.test.ts > normalizeRecent > отбрасывает мусор и дубликаты,line=58,column=20::AssertionError: expected [ { path: 'C:\a.pdf', …(2) }, …(1) ] to deeply equal [ { path: 'C:\a.pdf', …(2) }, ……

::error file=/Users/runner/work/PDFwright/PDFwright/tests/unit/main-helpers.test.ts,title=tests/unit/main-helpers.test.ts > RecentFilesStore > добавляет в начало%2C обрезает по лимиту и сохраняет на диск,line=80,column=37::AssertionError: expected [ 'C:\three.pdf', 'C:\two.pdf' ] to deeply equal [ '…
```

Полный вывод: [logs/unit.log](logs/unit.log)

## e2e: ошибки

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/e2e/convert.e2e.ts > Конвертация (собранное приложение) > «Выбрать файл…»: пароль зашифрованного файла, понятная ошибка битого, степень запоминается
AssertionError: expected 'Сжать PDFКартинки документа пересжима…' to contain 'изменение отменяет Ctrl+Z'

Expected: "изменение отменяет Ctrl+Z"
Received: "Сжать PDFКартинки документа пересжимаются в JPEG и уменьшаются до выбранного разрешения. Текст, шрифты и линии не меняются.Документдокумент.pdf3 стр.Выбрать файл…Степень сжатияСильное — 100 dpi, качество картинок заметно нижеСреднее — 150 dpi, хватает для экрана и печатиЛёгкое — 200 dpi, …

 ❯ tests/e2e/convert.e2e.ts:252:51
    250|     await expect.poll(() => dialog.isVisible()).toBe(true)
    251|     // Открытый документ: предупреждение про Ctrl+Z на месте.
    252|     await expect.poll(() => dialog.textContent()).toContain('изменение…
       |                                                   ^
    253|
    254|     await stubOpenDialog([locked])

Caused by: Error: Matcher did not succeed in time.
 ❯ tests/e2e/convert.e2e.ts:252:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  tests/e2e/viewer-qa.e2e.ts > Просмотр: исправления QA (собранное приложение) > «Разделить» не перезаписывает файлы, «Извлечь…» не переключает на новый файл
AssertionError: expected 'Разделить PDFЧасти сохраняются рядом …' to contain 'Показать в папке'

Expected: "Показать в папке"
Received: "Разделить PDFЧасти сохраняются рядом с исходником или в выбранную папку.Исходный файлдок.pdf3 стр.Выбрать файл…Как делитьПо диапазонам страницПо N страницКаждую страницу отдельноПапка для частей/var/folders/20/jp1_0n3n7kndh6rnbqb5344m0000gn/T/pdfwright-e2e-iaTvTMВыбрать…Будет создано файл…

 ❯ split tests/e2e/viewer-qa.e2e.ts:272:53
    270|       await dialog.getByRole('radio', { name: 'Каждую страницу отдельн…
    271|       await dialog.getByRole('button', { name: 'Разделить', exact: tru…
    272|       await expect.poll(() => dialog.textContent()).toContain('Показат…
       |                                                     ^
    273|       await dialog.getByRole('button', { name: 'Закрыть', exact: true …
    274|       await expect.poll(() => dialog.count()).toBe(0)
 ❯ tests/e2e/viewer-qa.e2e.ts:276:5

Caused by: Error: Matcher did not succeed in time.
 ❯ split tests/e2e/viewer-qa.e2e.ts:272:7
 ❯ tests/e2e/viewer-qa.e2e.ts:276:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  tests/e2e/viewer-qa.e2e.ts > Просмотр: исправления QA (собранное приложение) > «О программе»: падеж, диагностика, Markdown в лицензиях; свойства в низком окне
TimeoutError: locator.waitFor: Timeout 30000ms exceeded.
Call log:
  - waiting for getByText(/Windows x64 · версия для разработки/) to be visible

 ❯ tests/e2e/viewer-qa.e2e.ts:328:65
    326|     await page.keyboard.press('Control+,')
    327|     await page.getByRole('button', { name: 'О программе' }).click()
    328|     await page.getByText(/Windows x64 · версия для разработки/).waitFo…
       |                                                                 ^
    329|     await page.getByRole('button', { name: 'Скопировать диагностику' }…
    330|     await expect

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


 Test Files  3 failed | 12 passed (15)
      Tests  4 failed | 47 passed (51)
   Start at  20:04:16
   Duration  419.34s (tests 96%, import 4%)


::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/convert.e2e.ts,title=tests/e2e/convert.e2e.ts > Конвертация (собранное приложение) > «Выбрать файл…»%3A пароль зашифрованного файла%2C понятная ошибка битого%2C степень запоминается,line=252,column=51::AssertionError: expected 'Сжать PDFК…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/protect.e2e.ts,title=tests/e2e/protect.e2e.ts > Защита паролем (собранное приложение) > смена пароля на открытие сохраняет пароль владельца и запреты; запреты действуют в программе,line=217,column=61::TimeoutError: locator.waitFor: Timeou…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/viewer-qa.e2e.ts,title=tests/e2e/viewer-qa.e2e.ts > Просмотр%3A исправления QA (собранное приложение) > «Разделить» не перезаписывает файлы%2C «Извлечь…» не переключает на новый файл,line=272,column=53::AssertionError: expected 'Разделить…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/viewer-qa.e2e.ts,title=tests/e2e/viewer-qa.e2e.ts > Просмотр%3A исправления QA (собранное приложение) > «О программе»%3A падеж%2C диагностика%2C Markdown в лицензиях; свойства в низком окне,line=328,column=65::TimeoutError: locator.waitFo…
```

Полный вывод: [logs/e2e.log](logs/e2e.log)

## Файлы

- [app-files.txt](app-files.txt)

## Снимки (43)

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
- [mac-about.png](shots/mac-about.png)
- [mac-author.png](shots/mac-author.png)
- [mac-dark.png](shots/mac-dark.png)
- [mac-dock-window.png](shots/mac-dock-window.png)
- [mac-fullscreen.png](shots/mac-fullscreen.png)
- [mac-hotkeys.png](shots/mac-hotkeys.png)
- [mac-screen-dark.png](shots/mac-screen-dark.png)
- [mac-screen-titlebar.png](shots/mac-screen-titlebar.png)
- [mac-start.png](shots/mac-start.png)
- [mac-titlebar.png](shots/mac-titlebar.png)
- [mac-update-notice.png](shots/mac-update-notice.png)
- [markup-annotations.png](shots/markup-annotations.png)
- [markup-flatten.png](shots/markup-flatten.png)
- [markup-resize.png](shots/markup-resize.png)
- [markup-signature.png](shots/markup-signature.png)
- [ocr-dialog.png](shots/ocr-dialog.png)
- [ocr-done.png](shots/ocr-done.png)
- [ocr-selected.png](shots/ocr-selected.png)
- [protect-dialog.png](shots/protect-dialog.png)
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
