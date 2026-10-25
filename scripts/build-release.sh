#!/usr/bin/env bash
# Выпускная сборка одной командой из Git Bash на Windows.
# Создаёт в build/: PDFwright-Setup-x64.exe, PDFwright-Portable-x64.zip и SHA256SUMS.txt.
set -euo pipefail

script_directory="${BASH_SOURCE[0]%/*}"
if [[ "$script_directory" == "${BASH_SOURCE[0]}" ]]; then script_directory="."; fi
project_root="$(cd "$script_directory/.." && pwd)"
cd "$project_root"

for tool in npm cygpath powershell.exe; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: $tool не найден. Запускайте скрипт из Git Bash с установленным Node.js 24." >&2
    exit 1
  fi
done

release_dir="$project_root/build"
if [[ -L "$release_dir" ]]; then
  echo "ERROR: build — символическая ссылка, отказываемся её удалять." >&2
  exit 1
fi
rm -rf "$release_dir"

if [[ ! -d node_modules ]]; then
  echo "Устанавливаем зависимости…"
  npm ci
fi

echo "1/4 Проверки: линтер, типы, тесты, перечень лицензий"
npm run check
node scripts/third-party.mjs --check

echo "2/4 Сборка renderer, preload и main"
npm run build

echo "3/4 Установщик NSIS"
npx electron-builder --win nsis --x64 --publish never

echo "4/4 Portable-архив и контрольные суммы"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$project_root/scripts/package-release.ps1")"

echo
echo "Готово. Файлы для публикации:"
echo "  build/PDFwright-Setup-x64.exe       установщик (имя нельзя менять: его ищет обновлятор)"
echo "  build/PDFwright-Portable-x64.zip    переносная версия, распаковывать целиком"
echo "  build/SHA256SUMS.txt                контрольные суммы обоих файлов"
