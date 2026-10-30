# Итоги проверок CI

Служебная ветка: workflow `.github/workflows/mac.yml` после каждого прогона кладёт сюда
итог в папку `<ветка>/<процессор>/` (`arm64` — Apple Silicon, `x64` — Intel):

- `summary.md` — какие шаги прошли и какие упали, выдержки ошибок;
- `logs/` — полный вывод каждого шага;
- `shots/` — снимки экрана из e2e (`PDFWRIGHT_SHOTS`).

В ветке один коммит без истории: прогон заменяет только свою папку. Пишет её
`scripts/ci-results.mjs`. Прочитать:

```sh
git fetch origin ci/mac-results
git show origin/ci/mac-results:mac/prep/arm64/summary.md
git archive origin/ci/mac-results mac/prep | tar -x -C <папка>
```
