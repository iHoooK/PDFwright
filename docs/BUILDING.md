# Сборка из исходного кода

Нужны два инструмента:

1. [Git for Windows](https://git-scm.com/download/win) с пунктом **Git Bash Here**.
2. [Node.js 24 LTS](https://nodejs.org/) для Windows x64 (включает npm).

```bash
git clone git@github.com:iHoooK/PDFwright.git
cd PDFwright
npm ci
```

## Две команды

Откройте **Git Bash** в корне проекта.

### Выпускная сборка: установщик и portable-версия

```bash
bash scripts/build-release.sh
```

Запускает линтер, проверку типов и тесты, собирает программу и создаёт `build/PDFwright-Setup-x64.exe` (установщик), `build/PDFwright-Portable-x64.zip` (переносная версия) и `build/SHA256SUMS.txt` (контрольные суммы). NSIS и прочие инструменты упаковки electron-builder скачивает сам при первом запуске. Папка `build` создаётся заново и не попадает в GitHub. Ту же команду выполняет GitHub Actions на каждый push.

### Выпускная сборка для Mac

Только на Mac с Node.js 24 и Xcode Command Line Tools (`xcode-select --install`), в Терминале из корня проекта:

```bash
bash scripts/build-release-mac.sh
```

Запускает те же проверки, собирает программу для Apple Silicon и Intel и создаёт в `build/` четыре файла из раздела [Для Mac](../README.md#для-mac), `latest-mac.yml` (метаданные обновлятора) и `SHA256SUMS-Mac.txt`. Затем проверяет подпись (ad-hoc, без сертификата Apple) и `Info.plist`, распаковывает `.zip`, монтирует `.dmg` и запускает программу с тестовым PDF прямо из него, копирует её, как при перетаскивании в «Программы», и запускает копию. `--arch arm64` или `--arch x64` собирает один процессор, `--help` перечисляет остальные параметры. Ту же команду для выпуска выполняют Mac-машины GitHub Actions.

### Локальный запуск для проверки кода

```bash
bash scripts/run-local.sh
```

Запускает программу в режиме разработки с горячей перезагрузкой интерфейса. Можно передать файл: `npm run dev -- D:\\Документы\\договор.pdf`. Программа работает в одном экземпляре: второй запуск передаёт файл первому.

Другие команды: `npm run check` (линтер, типы, тесты), `npm run icons` (пересобрать иконку из `resources/icon.svg`), `npm run package` (распакованная сборка без установщика).

## Структура

```text
src/main      процесс Electron: окно, файлы, диалоги, настройки, обновления
src/preload   узкий типизированный мост между main и интерфейсом
src/renderer  интерфейс на React и TypeScript
src/shared    общий код: контракт IPC, схема настроек, операции над PDF
tests/unit    unit-тесты (vitest)
tests/e2e     сквозные тесты собранной программы (Playwright)
docs          план реализации и дизайн-документ
```
