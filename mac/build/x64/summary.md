# mac/build/x64

- Коммит: `0bba202` M2 готова: временные триггеры убраны, итоги и ссылки в плане
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/41141137303 (попытка 1)
- Машина: macOS 15.7.9 (x64), Node 24.19.0, Electron 45.0.0
- Время: 2026-10-30 23:19 UTC
- Итог: упали e2e

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 1 мин 13 с |  | `npm ci` |
| lint | ✅ прошёл | 44 с |  | `npm run lint` |
| typecheck | ✅ прошёл | 13 с |  | `npm run typecheck` |
| unit | ✅ прошёл | 19 с | 288 passed (288) | `npm test` |
| build | ✅ прошёл | 6 с |  | `npm run build` |
| e2e | ❌ упал (код 1) | 5 мин 39 с | 1 failed · 43 passed (44) | `npm run test:e2e` |
| package | ✅ прошёл | 42 с |  | `npx electron-builder --mac --dir --x64 --publish never` |
| app-info | ✅ прошёл | 0 с |  | `sh -c du -sh "$0"; plutil -p "$0/Contents/Info.plist"; codesign -dv "$0" 2>&1 \|\| true build/mac/PDFwright.app` |
| release | ✅ прошёл | 15 мин 25 с |  | `bash scripts/build-release-mac.sh --arch x64 --skip-checks --shots /Users/runner/work/_temp/ci-results/shots` |
| release-files | ✅ прошёл | 0 с |  | `sh -c ls -l build/PDFwright-*.dmg build/PDFwright-*.zip && cat build/latest-mac.yml build/SHA256SUMS-Mac.txt` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

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
   Start at  22:57:16
   Duration  337.54s (tests 95%, import 4%, transform 1%)


::error file=/Users/runner/work/PDFwright/PDFwright/tests/e2e/protect.e2e.ts,title=tests/e2e/protect.e2e.ts > Защита паролем (собранное приложение) > смена пароля на открытие сохраняет пароль владельца и запреты; запреты действуют в программе,line=217,column=61::TimeoutError: locator.waitFor: Timeou…
```

Полный вывод: [logs/e2e.log](logs/e2e.log)

## Файлы

- [app-files.txt](app-files.txt)

## Снимки (35)

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
- [screen-x64.png](shots/screen-x64.png)
- [update-notice.png](shots/update-notice.png)
- [update-settings.png](shots/update-settings.png)
- [window-x64.png](shots/window-x64.png)
- [windows-tab-menu.png](shots/windows-tab-menu.png)
