# mac/dmg-probe-clean/macos-15-intel

- Коммит: `b2afb46` ВРЕМЕННО: чистый замер запуска из .dmg без диагностики
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/41850831599 (попытка 1)
- Машина: macOS 15.7.9 (x64), Node 24.19.0, Electron 45.0.0
- Время: 2026-11-04 14:54 UTC
- Итог: все шаги прошли

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 1 мин 23 с |  | `npm ci` |
| build | ✅ прошёл | 4 с |  | `npm run build` |
| dmg | ✅ прошёл | 57 с |  | `npx electron-builder --mac dmg --x64 --publish never -c.directories.output=build/probe -c.dmg.artifactName=probe.dmg` |
| probe | ✅ прошёл | 6 мин 5 с |  | `node scripts/probe-dmg.mjs build/probe/probe.dmg tests/fixtures/simple.pdf /Users/runner/work/_temp/ci-results` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

## Файлы

- [probe-table.md](probe-table.md)
