#!/usr/bin/env bash
# Выпускная сборка для macOS одной командой (docs/MACOS_PLAN.md, фаза M2). Только на Mac.
# Создаёт в build/:
#   PDFwright-Mac-AppleSilicon.dmg, PDFwright-Mac-Intel.dmg      установщики (окно «перетащите в Программы»)
#   PDFwright-Portable-Mac-AppleSilicon.zip,
#   PDFwright-Portable-Mac-Intel.zip                             переносные версии
#   latest-mac.yml                                               метаданные обновлятора
#   SHA256SUMS-Mac.txt                                           контрольные суммы
#
# Каждый процессор собирается отдельным запуском electron-builder в свою папку
# build/mac-<arch>: в шаблоне имени процессор есть только как arm64/x64, а выпускные
# имена — AppleSilicon/Intel. Общий latest-mac.yml и суммы пишет scripts/mac-release-files.mjs.
# Подпись — ad-hoc (без Apple Developer ID); скрипт проверяет её и Info.plist в собранной
# программе, в .zip и в .dmg, устанавливает программу из .dmg копированием (как
# перетаскиванием в «Программы») и запускает её с тестовым PDF.
set -euo pipefail

usage() {
  cat <<'USAGE'
Запуск: bash scripts/build-release-mac.sh [параметры]
  --arch arm64|x64|all   процессоры (по умолчанию all — оба)
  --skip-checks          без линтера, типов и тестов (если их уже прогнали)
  --no-smoke             без дымового запуска программы, установленной из .dmg
  --shots <папка>        снимки окна и экрана при дымовом запуске
USAGE
}

arches="arm64 x64"
run_checks=1
run_smoke=1
shots_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      case "${2:-}" in
        arm64 | x64) arches="$2" ;;
        all) arches="arm64 x64" ;;
        *) echo "ERROR: --arch принимает arm64, x64 или all." >&2; exit 2 ;;
      esac
      shift 2
      ;;
    --skip-checks) run_checks=0; shift ;;
    --no-smoke) run_smoke=0; shift ;;
    --shots)
      if [[ -z "${2:-}" ]]; then echo "ERROR: после --shots нужна папка." >&2; exit 2; fi
      shots_dir="$2"
      shift 2
      ;;
    -h | --help) usage; exit 0 ;;
    *) echo "ERROR: неизвестный параметр $1" >&2; usage >&2; exit 2 ;;
  esac
done

script_directory="${BASH_SOURCE[0]%/*}"
if [[ "$script_directory" == "${BASH_SOURCE[0]}" ]]; then script_directory="."; fi
project_root="$(cd "$script_directory/.." && pwd)"
cd "$project_root"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: Mac-версия собирается только на macOS. Для Windows — bash scripts/build-release.sh." >&2
  exit 1
fi
for tool in npm node codesign plutil hdiutil ditto shasum lipo; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: $tool не найден. Нужны Node.js 24 и Xcode Command Line Tools (xcode-select --install)." >&2
    exit 1
  fi
done

if [[ -n "$shots_dir" && "$shots_dir" != /* ]]; then shots_dir="$project_root/$shots_dir"; fi

release_dir="$project_root/build"
if [[ -L "$release_dir" ]]; then
  echo "ERROR: build — символическая ссылка, отказываемся её удалять." >&2
  exit 1
fi
rm -rf "$release_dir"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/pdfwright-mac.XXXXXX")"
mounted=""
cleanup() {
  for mount_point in $mounted; do
    hdiutil detach "$mount_point" -quiet 2>/dev/null || hdiutil detach "$mount_point" -force -quiet 2>/dev/null || true
  done
  rm -rf "$work_dir"
}
trap cleanup EXIT

# Ad-hoc подпись без секретов, поэтому разрешаем её и в сборках pull request
# (иначе electron-builder пропускает подпись, и программа на Apple Silicon «повреждена»).
export CSC_FOR_PULL_REQUEST=true

arch_name() {
  case "$1" in
    arm64) echo "AppleSilicon" ;;
    x64) echo "Intel" ;;
  esac
}

lipo_arch() {
  case "$1" in
    arm64) echo "arm64" ;;
    x64) echo "x86_64" ;;
  esac
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# Подпись ad-hoc цела, Info.plist содержит минимальную macOS и ассоциацию .pdf,
# исполняемый файл собран под нужный процессор.
verify_app() {
  local app="$1" arch="$2"
  local plist="$app/Contents/Info.plist"
  [[ -d "$app" ]] || fail "не найдена программа $app"
  codesign --verify --deep --strict --verbose=2 "$app"
  local signature
  signature="$(codesign -dv --verbose=2 "$app" 2>&1)"
  grep -q '^Signature=adhoc$' <<<"$signature" || fail "$app: подпись не ad-hoc:
$signature"
  local minimum
  minimum="$(plutil -extract LSMinimumSystemVersion raw -o - "$plist")"
  [[ "$minimum" == "13.0" ]] || fail "$app: LSMinimumSystemVersion=$minimum, ожидалось 13.0"
  local document_types
  document_types="$(plutil -extract CFBundleDocumentTypes json -o - "$plist")"
  for expected in '"pdf"' '"Viewer"' '"Alternate"'; do
    grep -q "$expected" <<<"$document_types" || fail "$app: в CFBundleDocumentTypes нет $expected: $document_types"
  done
  for document in LICENSE.txt PRIVACY.md THIRD_PARTY_NOTICES.md; do
    [[ -f "$app/Contents/Resources/$document" ]] || fail "$app: нет Contents/Resources/$document (scripts/mac-sign.mjs)"
  done
  local binary_arches
  binary_arches="$(lipo -archs "$app/Contents/MacOS/PDFwright")"
  [[ "$binary_arches" == "$(lipo_arch "$arch")" ]] || fail "$app: процессоры $binary_arches, ожидался $(lipo_arch "$arch")"
  echo "  $app: ad-hoc подпись, macOS 13+, .pdf (Viewer, Alternate), $binary_arches"
}

# Можно ли запустить сборку этого процессора здесь: своя — всегда, Intel на Apple
# Silicon — только с Rosetta 2, Apple Silicon на Intel — никогда.
can_run() {
  local host
  host="$(uname -m)"
  if [[ "$(lipo_arch "$1")" == "$host" ]]; then return 0; fi
  [[ "$1" == "x64" && "$host" == "arm64" ]] && arch -x86_64 /usr/bin/true >/dev/null 2>&1
}

if [[ ! -d node_modules ]]; then
  echo "Устанавливаем зависимости…"
  npm ci
fi

if [[ "$run_checks" == 1 ]]; then
  echo "1/6 Проверки: линтер, типы, тесты, перечень лицензий"
  npm run check
  node scripts/third-party.mjs --check
else
  echo "1/6 Проверки пропущены (--skip-checks)"
fi

echo "2/6 Сборка renderer, preload и main"
npm run build

echo "3/6 electron-builder: .dmg и .zip ($arches)"
build_dirs=""
for arch in $arches; do
  name="$(arch_name "$arch")"
  npx electron-builder --mac dmg zip "--$arch" --publish never \
    "-c.directories.output=build/mac-$arch" \
    "-c.mac.artifactName=PDFwright-Portable-Mac-$name.\${ext}" \
    "-c.dmg.artifactName=PDFwright-Mac-$name.\${ext}"
  build_dirs="$build_dirs build/mac-$arch"
done

echo "4/6 Подпись и Info.plist собранной программы"
for arch in $arches; do
  app="$(find "build/mac-$arch" -maxdepth 2 -name PDFwright.app -type d | head -n 1)"
  verify_app "$app" "$arch"
done

echo "5/6 latest-mac.yml и SHA256SUMS-Mac.txt"
# shellcheck disable=SC2086 # список папок без пробелов
node scripts/mac-release-files.mjs build $build_dirs
(cd build && shasum -a 256 -c SHA256SUMS-Mac.txt)

echo "6/6 Готовые файлы: .zip, установка из .dmg и дымовой запуск"
for arch in $arches; do
  name="$(arch_name "$arch")"
  zip_file="build/PDFwright-Portable-Mac-$name.zip"
  dmg_file="build/PDFwright-Mac-$name.dmg"

  # .zip распаковывается так же, как Finder: ditto сохраняет ссылки внутри фреймворков.
  ditto -x -k "$zip_file" "$work_dir/zip-$arch"
  verify_app "$work_dir/zip-$arch/PDFwright.app" "$arch"

  mount_point="$work_dir/dmg-$arch"
  mkdir -p "$mount_point"
  hdiutil attach "$dmg_file" -nobrowse -readonly -noautoopen -mountpoint "$mount_point" >/dev/null
  mounted="$mounted $mount_point"
  [[ -L "$mount_point/Applications" && "$(readlink "$mount_point/Applications")" == "/Applications" ]] ||
    fail "$dmg_file: нет ссылки на «Программы»"
  verify_app "$mount_point/PDFwright.app" "$arch"
  # Установка, как перетаскиванием в «Программы»: копия во временную папку, образ отключается.
  # Запуск прямо из сжатого образа на macOS 26 (Apple Silicon) зависал при первой загрузке.
  installed="$work_dir/Applications-$arch/PDFwright.app"
  ditto "$mount_point/PDFwright.app" "$installed"
  hdiutil detach "$mount_point" -quiet
  mounted="${mounted% "$mount_point"}"
  verify_app "$installed" "$arch"

  if [[ "$run_smoke" == 1 ]]; then
    if can_run "$arch"; then
      node scripts/smoke-mac.mjs "$installed" tests/fixtures/simple.pdf "$arch" ${shots_dir:+"$shots_dir"}
    else
      echo "  Дымовой запуск $name пропущен: этот Mac не запускает программы для $(lipo_arch "$arch")."
    fi
  fi
done

echo
echo "Готово. Файлы для публикации:"
for file in build/PDFwright-Mac-*.dmg build/PDFwright-Portable-Mac-*.zip build/latest-mac.yml build/SHA256SUMS-Mac.txt; do
  LC_ALL=C awk -v name="$file" -v bytes="$(stat -f '%z' "$file")" \
    'BEGIN { printf "  %-45s %12d байт (%.1f МБ)\n", name, bytes, bytes / 1048576 }'
done
echo "Имена файлов не меняйте: их ищут README и latest-mac.yml."
