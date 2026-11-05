# mac/dmg-probe-open/macos-15-intel

- Коммит: `71cb6ef` ВРЕМЕННО: пробник печати на Mac, две машины вместо четырёх
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/41859500453 (попытка 1)
- Машина: macOS 15.7.9 (x64), Node 24.19.0, Electron 45.0.0
- Время: 2026-11-04 15:49 UTC
- Итог: все шаги прошли

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 1 мин 23 с |  | `npm ci` |
| build | ✅ прошёл | 3 с |  | `npm run build` |
| print | ✅ прошёл | 1 мин 25 с |  | `node scripts/probe-print.mjs tests/fixtures/simple.pdf /Users/runner/work/_temp/ci-results` |
| dmg | ✅ прошёл | 1 мин 6 с |  | `npx electron-builder --mac dmg --x64 --publish never -c.directories.output=build/probe -c.dmg.artifactName=probe.dmg` |
| probe | ✅ прошёл | 8 мин 27 с |  | `node scripts/probe-dmg.mjs build/probe/probe.dmg tests/fixtures/simple.pdf /Users/runner/work/_temp/ci-results` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

## Файлы

- [details.log](details.log)
- [probe-table.md](probe-table.md)

## Снимки (8)

- [print-no-printer-10s.png](shots/print-no-printer-10s.png)
- [print-no-printer-30s.png](shots/print-no-printer-30s.png)
- [print-no-printer-3s.png](shots/print-no-printer-3s.png)
- [print-no-printer-after.png](shots/print-no-printer-after.png)
- [print-printer-10s.png](shots/print-printer-10s.png)
- [print-printer-30s.png](shots/print-printer-30s.png)
- [print-printer-3s.png](shots/print-printer-3s.png)
- [print-printer-after.png](shots/print-printer-after.png)
