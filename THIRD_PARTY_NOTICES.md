# Third-party components

Собственный код и иконка PDFwright распространяются по MIT `LICENSE` в корне репозитория. Сторонние компоненты сохраняют свои лицензии; проект не претендует на их авторство.

Таблица ниже перечисляет компоненты, попадающие в поставку пользователю. Инструменты сборки (Vite, TypeScript, ESLint, Prettier, Vitest, electron-builder) в программу не включаются. Перед каждым релизом таблица сверяется с `package-lock.json`.

| Компонент                                        | Назначение                                     | Лицензия / источник                                                                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron (включая Chromium и Node.js)            | Среда выполнения приложения                    | MIT; Chromium — BSD-3-Clause и лицензии его компонентов; [electron/electron](https://github.com/electron/electron)                                                                                                                                |
| React, React DOM                                 | Интерфейс                                      | MIT; [facebook/react](https://github.com/facebook/react)                                                                                                                                                                                          |
| Fluent UI System Icons (`@fluentui/react-icons`) | Иконки интерфейса                              | MIT; [microsoft/fluentui-system-icons](https://github.com/microsoft/fluentui-system-icons)                                                                                                                                                        |
| pdf.js (`pdfjs-dist`)                            | Рендеринг PDF, текстовый слой, поиск, закладки | Apache-2.0; [mozilla/pdf.js](https://github.com/mozilla/pdf.js). В поставку входят CMaps, стандартные шрифты (Foxit, Liberation) и WASM-декодеры OpenJPEG/JBIG2 из того же пакета, их лицензии лежат в `pdfjs/wasm/LICENSE_*` рядом с программой. |

Планируется добавить при реализации соответствующих фаз:

| Компонент        | Назначение                                            | Лицензия / источник                                                                              |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| pdf-lib          | Изменение PDF: страницы, аннотации, формы, метаданные | MIT; [Hopding/pdf-lib](https://github.com/Hopding/pdf-lib)                                       |
| electron-updater | Проверка и установка обновлений с GitHub Releases     | MIT; [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) |

NSIS используется только как инструмент сборки установщика и в программу не входит. Шрифты системы Windows не распространяются.
