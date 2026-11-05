# mac/dmg-probe/macos-26-intel

- Коммит: `4c96fb5` ВРЕМЕННО: разбор annotations:307 и запуска прямо из .dmg
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/41846773079 (попытка 1)
- Машина: macOS 26.6.1 (x64), Node 24.19.0, Electron 45.0.0
- Время: 2026-11-04 14:36 UTC
- Итог: все шаги прошли

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 3 мин 23 с |  | `npm ci` |
| build | ✅ прошёл | 6 с |  | `npm run build` |
| dmg | ✅ прошёл | 1 мин 31 с |  | `npx electron-builder --mac dmg --x64 --publish never -c.directories.output=build/probe -c.dmg.artifactName=probe.dmg` |
| probe | ✅ прошёл | 9 мин 46 с |  | `node scripts/probe-dmg.mjs build/probe/probe.dmg tests/fixtures/simple.pdf /Users/runner/work/_temp/ci-results` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

## Файлы

- [details.log](details.log)
- [probe-table.md](probe-table.md)

## Снимки (2)

- [built-cold-30s.png](shots/built-cold-30s.png)
- [built-cold-90s.png](shots/built-cold-90s.png)
