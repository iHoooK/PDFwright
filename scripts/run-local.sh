#!/usr/bin/env bash
# Локальный запуск для проверки кода: собирает dev-версию и открывает окно
# с горячей перезагрузкой renderer. Установщик не создаётся.
set -euo pipefail

script_directory="${BASH_SOURCE[0]%/*}"
if [[ "$script_directory" == "${BASH_SOURCE[0]}" ]]; then script_directory="."; fi
project_root="$(cd "$script_directory/.." && pwd)"
cd "$project_root"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Node.js (npm) не найден. Установите Node.js 24 LTS и откройте Git Bash заново." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Устанавливаем зависимости (первый запуск)…"
  npm ci
fi

npm run dev
