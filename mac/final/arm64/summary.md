# mac/final/arm64

- Коммит: `c6b8ee7` M3 готова: временные триггеры убраны, итоги и ссылки в плане
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/41904282923 (попытка 1)
- Машина: macOS 26.6.2 (arm64), Node 24.22.1, Electron 45.0.0
- Время: 2026-11-04 20:23 UTC
- Итог: все шаги прошли

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 51 с |  | `npm ci` |
| lint | ✅ прошёл | 19 с |  | `npm run lint` |
| typecheck | ✅ прошёл | 5 с |  | `npm run typecheck` |
| unit | ✅ прошёл | 8 с | 320 passed (320) | `npm test` |
| build | ✅ прошёл | 1 с |  | `npm run build` |
| e2e | ✅ прошёл | 3 мин 33 с | 55 passed · 1 skipped (56) | `npm run test:e2e` |
| package | ✅ прошёл | 8 с |  | `npx electron-builder --mac --dir --arm64 --publish never` |
| app-info | ✅ прошёл | 0 с |  | `sh -c du -sh "$0"; plutil -p "$0/Contents/Info.plist"; codesign -dv "$0" 2>&1 \|\| true build/mac-arm64/PDFwright.app` |
| release | ✅ прошёл | 6 мин 27 с |  | `bash scripts/build-release-mac.sh --arch arm64 --skip-checks --shots /Users/runner/work/_temp/ci-results/shots` |
| release-files | ✅ прошёл | 0 с |  | `sh -c ls -l build/PDFwright-*.dmg build/PDFwright-*.zip && cat build/latest-mac.yml build/SHA256SUMS-Mac.txt` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

## Файлы

- [app-files.txt](app-files.txt)

## Снимки (56)

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
- [dmg-arm64.png](shots/dmg-arm64.png)
- [english.png](shots/english.png)
- [forms-filled.png](shots/forms-filled.png)
- [forms-metadata.png](shots/forms-metadata.png)
- [key-1-start.png](shots/key-1-start.png)
- [key-2-viewer.png](shots/key-2-viewer.png)
- [key-3-edit.png](shots/key-3-edit.png)
- [key-4-markup.png](shots/key-4-markup.png)
- [key-5-settings.png](shots/key-5-settings.png)
- [key-6-dark.png](shots/key-6-dark.png)
- [key-7-english.png](shots/key-7-english.png)
- [mac-about.png](shots/mac-about.png)
- [mac-author.png](shots/mac-author.png)
- [mac-copy-blocked.png](shots/mac-copy-blocked.png)
- [mac-dark.png](shots/mac-dark.png)
- [mac-dock-window.png](shots/mac-dock-window.png)
- [mac-fullscreen.png](shots/mac-fullscreen.png)
- [mac-hotkeys.png](shots/mac-hotkeys.png)
- [mac-screen-dark.png](shots/mac-screen-dark.png)
- [mac-screen-finder.png](shots/mac-screen-finder.png)
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
- [qa-licenses.png](shots/qa-licenses.png)
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
