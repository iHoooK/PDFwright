# mac/trial/arm64

- Коммит: `66f219f` Merge remote-tracking branch 'origin/mac/build' into mac/trial
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/41142077753 (попытка 1)
- Машина: macOS 26.6.2 (arm64), Node 24.21.0, Electron 45.0.0
- Время: 2026-10-30 23:15 UTC
- Итог: упали e2e

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 17 с |  | `npm ci` |
| lint | ✅ прошёл | 18 с |  | `npm run lint` |
| typecheck | ✅ прошёл | 5 с |  | `npm run typecheck` |
| unit | ✅ прошёл | 7 с | 320 passed (320) | `npm test` |
| build | ✅ прошёл | 1 с |  | `npm run build` |
| e2e | ❌ упал (код 1) | 4 мин 29 с | 5 failed · 46 passed (51) | `npm run test:e2e` |
| package | ✅ прошёл | 8 с |  | `npx electron-builder --mac --dir --arm64 --publish never` |
| app-info | ✅ прошёл | 0 с |  | `sh -c du -sh "$0"; plutil -p "$0/Contents/Info.plist"; codesign -dv "$0" 2>&1 \|\| true build/mac-arm64/PDFwright.app` |
| release | ✅ прошёл | 6 мин 14 с |  | `bash scripts/build-release-mac.sh --arch arm64 --skip-checks --shots /Users/runner/work/_temp/ci-results/shots` |
| release-files | ✅ прошёл | 0 с |  | `sh -c ls -l build/PDFwright-*.dmg build/PDFwright-*.zip && cat build/latest-mac.yml build/SHA256SUMS-Mac.txt` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

## e2e: ошибки

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/e2e/annotations.e2e.ts > заметки и аннотации документа > группа: Ctrl+щелчок, перенос одним шагом отмены, рамка с Shift и удаление
AssertionError: expected -126.671875 to be greater than 30
 ❯ tests/e2e/annotations.e2e.ts:307:54
    305|       (await boxOf(page, selector)).y - from.y
    306|     await drag(page, 1, share(300, 280), share(300, 230))
    307|     await expect.poll(() => shift(rect, rectBefore)).toBeGreaterThan(3…
       |                                                      ^
    308|     await expect.poll(() => shift(square, squareBefore)).toBeGreaterTh…
    309|     expect(await page.locator('[data-selection-group="3"]').count()).t…

Caused by: Error: Matcher did not succeed in time.
 ❯ tests/e2e/annotations.e2e.ts:307:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/5]⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/5]⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/5]⎯

 FAIL  tests/e2e/viewer-qa.e2e.ts > Просмотр: исправления QA (собранное приложение) > «Разделить» не перезаписывает файлы, «Извлечь…» не переключает на новый файл
AssertionError: expected 'Разделить PDFЧасти сохраняются рядом …' to contain 'Показать в папке'

Expected: "Показать в папке"
Received: "Разделить PDFЧасти сохраняются рядом с исходником или в выбранную папку.Исходный файлдок.pdf3 стр.Выбрать файл…Как делитьПо диапазонам страницПо N страницКаждую страницу отдельноПапка для частей/var/folders/n6/hn37q6pj7sj_9dmqqc2113800000gn/T/pdfwright-e2e-ISxzIUВыбрать…Будет создано файл…

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/5]⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯


 Test Files  4 failed | 11 passed (15)
      Tests  5 failed | 46 passed (51)
   Start at  23:04:19
   Duration  268.62s (tests 98%, import 2%)


::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/annotations.e2e.ts,title=tests/e2e/annotations.e2e.ts > заметки и аннотации документа > группа%3A Ctrl+щелчок%2C перенос одним шагом отмены%2C рамка с Shift и удаление,line=307,column=54::AssertionError: expected -126.671875 to be greater…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/convert.e2e.ts,title=tests/e2e/convert.e2e.ts > Конвертация (собранное приложение) > «Выбрать файл…»%3A пароль зашифрованного файла%2C понятная ошибка битого%2C степень запоминается,line=252,column=51::AssertionError: expected 'Сжать PDFК…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/protect.e2e.ts,title=tests/e2e/protect.e2e.ts > Защита паролем (собранное приложение) > смена пароля на открытие сохраняет пароль владельца и запреты; запреты действуют в программе,line=217,column=61::TimeoutError: locator.waitFor: Timeou…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/viewer-qa.e2e.ts,title=tests/e2e/viewer-qa.e2e.ts > Просмотр%3A исправления QA (собранное приложение) > «Разделить» не перезаписывает файлы%2C «Извлечь…» не переключает на новый файл,line=272,column=53::AssertionError: expected 'Разделить…

::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/viewer-qa.e2e.ts,title=tests/e2e/viewer-qa.e2e.ts > Просмотр%3A исправления QA (собранное приложение) > «О программе»%3A падеж%2C диагностика%2C Markdown в лицензиях; свойства в низком окне,line=328,column=65::TimeoutError: locator.waitFo…
```

Полный вывод: [logs/e2e.log](logs/e2e.log)

## Файлы

- [app-files.txt](app-files.txt)

## Снимки (44)

- [annotations-edited.png](shots/annotations-edited.png)
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
- [screen-arm64.png](shots/screen-arm64.png)
- [update-notice.png](shots/update-notice.png)
- [update-settings.png](shots/update-settings.png)
- [window-arm64.png](shots/window-arm64.png)
- [windows-tab-menu.png](shots/windows-tab-menu.png)
