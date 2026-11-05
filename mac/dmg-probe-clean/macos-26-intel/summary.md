# mac/dmg-probe-clean/macos-26-intel

- Коммит: `b2afb46` ВРЕМЕННО: чистый замер запуска из .dmg без диагностики
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/41850831599 (попытка 1)
- Машина: macOS 26.6.1 (x64), Node 24.19.0, Electron 45.0.0
- Время: 2026-11-04 14:58 UTC
- Итог: все шаги прошли

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 2 мин 48 с |  | `npm ci` |
| build | ✅ прошёл | 5 с |  | `npm run build` |
| dmg | ✅ прошёл | 1 мин 20 с |  | `npx electron-builder --mac dmg --x64 --publish never -c.directories.output=build/probe -c.dmg.artifactName=probe.dmg` |
| probe | ✅ прошёл | 8 мин 0 с |  | `node scripts/probe-dmg.mjs build/probe/probe.dmg tests/fixtures/simple.pdf /Users/runner/work/_temp/ci-results` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

## Файлы

- [probe-table.md](probe-table.md)
