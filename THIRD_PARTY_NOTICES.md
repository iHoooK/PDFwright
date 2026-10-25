# Third-party components

Собственный код и иконка PDFwright распространяются по GNU AGPL-3.0-or-later (`LICENSE` в корне репозитория). Сторонние компоненты сохраняют свои лицензии; проект не претендует на их авторство.

Таблица ниже перечисляет компоненты, попадающие в поставку пользователю. Инструменты сборки (Vite, TypeScript, ESLint, Prettier, Vitest, electron-builder) в программу не включаются. Перед каждым релизом таблица сверяется с `package-lock.json`.

| Компонент                                        | Назначение                                        | Лицензия / источник                                                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron (включая Chromium и Node.js)            | Среда выполнения приложения                       | MIT; Chromium — BSD-3-Clause и лицензии его компонентов; [electron/electron](https://github.com/electron/electron)                                                                                                                                |
| React, React DOM                                 | Интерфейс                                         | MIT; [facebook/react](https://github.com/facebook/react)                                                                                                                                                                                          |
| Fluent UI System Icons (`@fluentui/react-icons`) | Иконки интерфейса                                 | MIT; [microsoft/fluentui-system-icons](https://github.com/microsoft/fluentui-system-icons)                                                                                                                                                        |
| pdf-lib                                          | Изменение PDF: страницы, объединение, разделение  | MIT; [Hopding/pdf-lib](https://github.com/Hopding/pdf-lib)                                                                                                                                                                                        |
| electron-updater                                 | Проверка и установка обновлений с GitHub Releases | MIT; [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder)                                                                                                                                                  |
| pdf.js (`pdfjs-dist`)                            | Рендеринг PDF, текстовый слой, поиск, закладки    | Apache-2.0; [mozilla/pdf.js](https://github.com/mozilla/pdf.js). В поставку входят CMaps, стандартные шрифты (Foxit, Liberation) и WASM-декодеры OpenJPEG/JBIG2 из того же пакета, их лицензии лежат в `pdfjs/wasm/LICENSE_*` рядом с программой. |

Планируется добавить при реализации соответствующих фаз:

| Компонент        | Назначение                                        | Лицензия / источник                                                                              |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| electron-updater | Проверка и установка обновлений с GitHub Releases | MIT; [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) |

NSIS используется только как инструмент сборки установщика и в программу не входит. Шрифты системы Windows не распространяются.

## Полный перечень пакетов в поставке

<!-- deps:start -->

Сгенерировано `node scripts/third-party.mjs` из `package-lock.json`: 38 пакетов.

| Пакет                   | Версия  | Лицензия          |
| ----------------------- | ------- | ----------------- |
| @babel/runtime          | 7.29.10 | MIT               |
| @emotion/hash           | 0.9.2   | MIT               |
| @fluentui/react-icons   | 2.0.344 | MIT               |
| @griffel/core           | 1.21.4  | MIT               |
| @griffel/react          | 1.7.8   | MIT               |
| @griffel/style-types    | 1.4.3   | MIT               |
| @pdf-lib/fontkit        | 1.1.1   | MIT               |
| @pdf-lib/standard-fonts | 1.0.0   | MIT               |
| @pdf-lib/upng           | 1.0.1   | MIT               |
| argparse                | 2.0.1   | Python-2.0        |
| builder-util-runtime    | 9.7.0   | MIT               |
| csstype                 | 3.2.3   | MIT               |
| debug                   | 4.4.3   | MIT               |
| electron                | 45.0.0  | MIT               |
| electron-updater        | 6.8.11  | MIT               |
| fs-extra                | 10.1.0  | MIT               |
| graceful-fs             | 4.2.11  | ISC               |
| js-yaml                 | 4.3.2   | MIT               |
| jsonfile                | 6.2.1   | MIT               |
| lazy-val                | 1.0.5   | MIT               |
| lodash.escaperegexp     | 4.1.2   | MIT               |
| lodash.isequal          | 4.5.0   | MIT               |
| ms                      | 2.1.3   | MIT               |
| mupdf                   | 1.28.1  | AGPL-3.0-or-later |
| pako                    | 1.0.11  | (MIT AND Zlib)    |
| pdf-lib                 | 1.17.1  | MIT               |
| pdfjs-dist              | 6.4.299 | Apache-2.0        |
| react                   | 19.3.1  | MIT               |
| react-dom               | 19.3.1  | MIT               |
| rtl-css-js              | 1.16.1  | MIT               |
| sax                     | 1.6.1   | BlueOak-1.0.0     |
| scheduler               | 0.28.0  | MIT               |
| semver                  | 7.7.4   | ISC               |
| stylis                  | 4.4.0   | MIT               |
| tiny-typed-emitter      | 2.1.0   | MIT               |
| tslib                   | 1.14.1  | 0BSD              |
| tslib                   | 2.8.1   | 0BSD              |
| universalify            | 2.0.1   | MIT               |

<!-- deps:end -->
