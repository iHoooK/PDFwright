# mac/v101-probe/macos-26

- Коммит: `d7a8390` ВРЕМЕННО: замер запуска из .dmg через Finder и ⌘P в собранной программе
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/41925015755 (попытка 1)
- Машина: macOS 26.6.2 (arm64), Node 24.22.1, Electron 45.0.0
- Время: 2026-11-04 22:29 UTC
- Итог: все шаги прошли

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 1 мин 16 с |  | `npm ci` |
| build | ✅ прошёл | 3 с |  | `npm run build` |
| dmg | ✅ прошёл | 51 с |  | `npx electron-builder --mac dmg --arm64 --publish never -c.directories.output=build/probe -c.dmg.artifactName=probe.dmg` |
| probe | ✅ прошёл | 2 мин 6 с |  | `node scripts/probe-dmg.mjs build/probe/probe.dmg tests/fixtures/simple.pdf /Users/runner/work/_temp/ci-results` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

## Файлы

- [probe-table.md](probe-table.md)

## Снимки (3)

- [dmg-window.png](shots/dmg-window.png)
- [print-no-printer.png](shots/print-no-printer.png)
- [print-with-printer.png](shots/print-with-printer.png)
