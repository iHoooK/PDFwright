# mac/dmg-probe/macos-15

- Коммит: `4c96fb5` ВРЕМЕННО: разбор annotations:307 и запуска прямо из .dmg
- Прогон: https://github.com/iHoooK/PDFwright/actions/runs/41846773079 (попытка 1)
- Машина: macOS 15.8.2 (arm64), Node 24.22.1, Electron 45.0.0
- Время: 2026-11-04 14:28 UTC
- Итог: все шаги прошли

| Шаг | Итог | Время | Тесты | Команда |
| --- | --- | --- | --- | --- |
| install | ✅ прошёл | 1 мин 9 с |  | `npm ci` |
| build | ✅ прошёл | 2 с |  | `npm run build` |
| dmg | ✅ прошёл | 44 с |  | `npx electron-builder --mac dmg --arm64 --publish never -c.directories.output=build/probe -c.dmg.artifactName=probe.dmg` |
| probe | ✅ прошёл | 4 мин 27 с |  | `node scripts/probe-dmg.mjs build/probe/probe.dmg tests/fixtures/simple.pdf /Users/runner/work/_temp/ci-results` |

Шагов, которых нет в таблице, в прогоне не было: их пропустил workflow.

## Файлы

- [details.log](details.log)
- [probe-table.md](probe-table.md)

## Снимки (2)

- [built-cold-30s.png](shots/built-cold-30s.png)
- [built-open-cold-30s.png](shots/built-open-cold-30s.png)
