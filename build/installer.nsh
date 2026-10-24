; Дополнительные страницы и шаги установщика PDFwright (electron-builder NSIS).
; Файл в UTF-8 с BOM: Unicode-NSIS читает кириллицу только так.
; electron-builder подключает этот файл до MUI2, поэтому всё, что использует
; макросы MUI, лежит внутри customPageAfterChangeDir: он вставляется позже,
; в последовательности страниц мастера.
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; В проходе сборки деинсталлятора страница не вставляется, и неиспользуемые
; переменные дают предупреждение, которое electron-builder считает ошибкой.
!ifndef BUILD_UNINSTALLER
Var PwDesktopCheck
Var PwAssocCheck
Var PwDesktop
Var PwAssoc
!endif

; Страница с задачами после выбора папки: значок на рабочем столе и регистрация
; для файлов .pdf. Обе задачи по умолчанию выключены, как у ЛовиКадра.
!macro customPageAfterChangeDir
  Page custom PwOptionsPage PwOptionsLeave

  Function PwOptionsPage
    !insertmacro MUI_HEADER_TEXT "Дополнительные задачи" "Выберите, что ещё сделать при установке"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 12u 100% 12u "Создать значок на рабочем столе"
    Pop $PwDesktopCheck
    ${NSD_CreateCheckbox} 0 32u 100% 12u "Зарегистрировать PDFwright для файлов .pdf (появится в «Открыть с помощью»)"
    Pop $PwAssocCheck
    ${NSD_CreateLabel} 0 56u 100% 24u "Программой по умолчанию для PDF Windows разрешает назначить только вручную: Параметры → Приложения → Приложения по умолчанию."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function PwOptionsLeave
    ${NSD_GetState} $PwDesktopCheck $PwDesktop
    ${NSD_GetState} $PwAssocCheck $PwAssoc
  FunctionEnd
!macroend

!macro customInstall
  ${If} $PwDesktop == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\PDFwright.lnk" "$INSTDIR\PDFwright.exe"
  ${EndIf}
  ${If} $PwAssoc == ${BST_CHECKED}
    ; ProgID и регистрация в «Программах по умолчанию». SHCTX = HKLM при установке для всех.
    WriteRegStr SHCTX "Software\Classes\PDFwright.pdf" "" "Документ PDF"
    WriteRegStr SHCTX "Software\Classes\PDFwright.pdf\DefaultIcon" "" "$INSTDIR\PDFwright.exe,0"
    WriteRegStr SHCTX "Software\Classes\PDFwright.pdf\shell\open\command" "" '"$INSTDIR\PDFwright.exe" "%1"'
    WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "PDFwright.pdf" ""
    WriteRegStr SHCTX "Software\PDFwright\Capabilities" "ApplicationName" "PDFwright"
    WriteRegStr SHCTX "Software\PDFwright\Capabilities" "ApplicationDescription" "Просмотр и редактирование PDF"
    WriteRegStr SHCTX "Software\PDFwright\Capabilities\FileAssociations" ".pdf" "PDFwright.pdf"
    WriteRegStr SHCTX "Software\RegisteredApplications" "PDFwright" "Software\PDFwright\Capabilities"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\PDFwright.lnk"
  DeleteRegKey SHCTX "Software\Classes\PDFwright.pdf"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "PDFwright.pdf"
  DeleteRegKey SHCTX "Software\PDFwright"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "PDFwright"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
