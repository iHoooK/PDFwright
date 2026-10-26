/* eslint-disable react-refresh/only-export-components -- модуль состояния, не компонент */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode
} from 'react'
import type {
  AppCommand,
  AppInfo,
  PdfwrightApi,
  RecentFile,
  UpdateInfoSummary
} from '@shared/ipc-contract'
import { describeUpdateError } from '@shared/update-messages'
import { RELEASES_PAGE } from '@shared/external-links'
import {
  createDefaultSettings,
  SIGNATURES_MAX,
  type AppSettings,
  type Language,
  type MarkupSaveMode,
  type SettingsPatch,
  type Theme,
  type ZoomMode as DefaultZoomMode
} from '@shared/settings-schema'
import {
  applyFormValues,
  applyMarkup,
  clearMetadata,
  computeMoveOrder,
  deletePages,
  duplicatePages,
  extractPages,
  formatPageList,
  insertBlankPage,
  insertPagesFrom,
  isIdentityOrder,
  reorderPages,
  rotatePages,
  writeMetadata,
  type DocumentMetadata,
  type FormValue,
  type FormValues
} from '@shared/pdf-ops'
import { findMatches, type TextMatch } from '@shared/pdf-search'
import { pushSnapshot, type Snapshot } from '@shared/markup/history'
import {
  boxRectCentered,
  normalizeTurn,
  shiftInside,
  type Point,
  type Rect
} from '@shared/markup/geometry'
import {
  isMovable,
  moveObject,
  newMarkupId,
  type MarkupObject,
  type ShapeKind,
  type TextMarkKind
} from '@shared/markup/model'
import { NOTE_COLOR } from '@shared/markup/note'
import type { AnnotationPatch, PageAnnotation } from '@shared/pdf-content/annotations'
import { basenameOf, dirnameOf, joinPath, safeFileName, stripExtension } from '@shared/paths'
import type {
  PageGraphic,
  PageImage,
  PageTextBlock,
  PageTextLine,
  PdfSpacePoint,
  PdfSpaceRect,
  TextStyle,
  TextStylePatch
} from '@shared/pdf-content/types'
import {
  loadPdfDocument,
  PdfLoadError,
  type PasswordReason,
  type PdfDocument,
  type Rotation
} from '@renderer/pdf-engine/engine'
import { t } from '@renderer/i18n'
import { loadMarkupFont } from '@renderer/features/markup/font'
import { imageSize, readImageBytes, readImageFile } from '@renderer/features/markup/images'
import {
  hasTarget,
  sameTarget,
  selectedMarkupId,
  type ContentTarget,
  type PageContentObject,
  type SelectionTarget
} from '@renderer/features/markup/selection'
import { findAnnotation } from '@renderer/features/annotations/page-annotations'
import { pdfContent } from '@renderer/pdf-content/client'
import type { ProtectionInfo, ProtectOptions } from '@shared/pdf-content/protect'
import { getApi } from './api'
import { applyTheme, resolvedTheme } from './theme'

export type Screen = 'start' | 'viewer' | 'settings' | 'kit' | 'compare'
export type Tool =
  'select' | 'edit' | 'hand' | 'marker' | 'pen' | 'shapes' | 'text' | 'note' | 'sign'
/** Инструмент «Правка»: выбор объектов документа, новый текст или ластик области. */
export type ContentMode = 'objects' | 'text' | 'erase'
/** Что делать с содержимым под абзацем, когда он стал выше или ниже. */
export type ContentShift = 'page' | 'column' | 'none'
type ContentEditKind = keyof typeof t.content.done
export type SidebarTab = 'thumbs' | 'outline' | 'search'
export type SettingsSection = 'general' | 'view' | 'updates' | 'about' | 'author'
export type ZoomMode = 'fit-width' | 'fit-page' | 'custom'
/** Диалоги конвертации (фаза 6). */
export type ConvertDialog = 'toImages' | 'fromImages' | 'extractText' | 'compress'
export type ToolDialog = 'merge' | 'split' | 'protect' | ConvertDialog | 'ocr' | null
export type SelectMode = 'single' | 'toggle' | 'range'
/** Инструменты со своим цветом, непрозрачностью и толщиной в панели свойств. */
export type StyledTool = 'marker' | 'pen' | 'shapes' | 'text' | 'note'

/** Документ-источник для конвертации: байты с записанной несохранённой разметкой. */
export interface ConvertSource {
  name: string
  /** Путь файла; пустой у нового несохранённого документа. */
  path: string
  bytes: Uint8Array
  pages: number
}

export interface ToolStyle {
  color: string
  /** 0..1 */
  opacity: number
  /** Толщина линии, пт. */
  width: number
  /** Кегль текста, пт. */
  fontSize: number
}

/**
 * Шаг истории вкладки: байты документа и несохранённая разметка. Правки
 * разметки делят байты с соседними шагами, поэтому отмена работает одним
 * стеком и для операций со страницами, и для объектов (см. markup/history).
 */
export type TabSnapshot = Snapshot<Uint8Array, readonly MarkupObject[]> & {
  /** Несохранённые значения полей формы на этом шаге. */
  forms?: FormValues
  /** Защита паролем на этом шаге; нет поля — та же, что сейчас. */
  protection?: DocProtection | null | undefined
}

// Защита паролем
/**
 * Защита документа вкладки. Байты вкладки всегда расшифрованы (их понимают
 * pdf-lib, MuPDF и pdf.js), а шифрование возвращается при записи файла.
 * Пароли живут только в памяти вкладки: в настройки, сеанс и журнал не попадают.
 */
export type DocProtection =
  | {
      /** Файл, открытый паролем: записывается с прежним ключом, оба пароля сохраняются. */
      kind: 'file'
      original: Uint8Array
      /** Расшифрованная копия файла: без правок записывается сам исходный файл. */
      plain: Uint8Array
      password: string
      info: ProtectionInfo
    }
  | {
      /** Новый пароль: файл шифруется AES-256 при записи. */
      kind: 'new'
      options: ProtectOptions
    }

/** Байты для записи файла: расшифрованная копия вкладки снова шифруется. */
async function lockForWrite(
  protection: DocProtection | null | undefined,
  bytes: Uint8Array
): Promise<Uint8Array> {
  if (!protection) return bytes
  if (protection.kind === 'new') return pdfContent.protectPdf(bytes, protection.options)
  if (bytes === protection.plain) return protection.original
  return pdfContent.relockPdf(protection.original, protection.password, bytes)
}

/**
 * Документ, открытый паролем (или зашифрованный без пароля на открытие),
 * расшифровывается для правки; если MuPDF не справился, вкладка остаётся с
 * зашифрованными байтами, как раньше.
 */
async function unlockOpened(
  doc: PdfDocument,
  bytes: Uint8Array,
  password: string | null
): Promise<{ bytes: Uint8Array; protection: DocProtection | null }> {
  if (password === null && !(await doc.getProperties()).encrypted) {
    return { bytes, protection: null }
  }
  try {
    const result = await pdfContent.unlockPdf(bytes, password ?? '')
    if (!result.info) return { bytes, protection: null }
    return {
      bytes: result.bytes,
      protection: {
        kind: 'file',
        original: bytes,
        plain: result.bytes,
        password: password ?? '',
        info: result.info
      }
    }
  } catch (error) {
    console.warn(
      `[pdfwright] зашифрованный документ не расшифрован для правки: ${error instanceof Error ? error.message : String(error)}`
    )
    return { bytes, protection: null }
  }
}

const NO_FORMS: FormValues = {}
const hasForms = (tab: DocTab): boolean => Object.keys(tab.forms).length > 0
const sameFormValue = (a: FormValue | undefined, b: FormValue): boolean =>
  a !== undefined &&
  (typeof a === 'string' || typeof b === 'string'
    ? a === b
    : a.length === b.length && a.every((v, i) => v === b[i]))

export interface DocTab {
  id: string
  name: string
  path: string
  status: 'loading' | 'ready' | 'error'
  doc: PdfDocument | null
  pages: number
  fileSize: number
  error: string | null
  /** Растёт по мере чтения размеров страниц, чтобы раскладка обновлялась. */
  sizesVersion: number
  /** Текущие байты документа со всеми применёнными правками. */
  bytes: Uint8Array | null
  dirty: boolean
  /** Объекты разметки, ещё не записанные в байты документа. */
  markup: readonly MarkupObject[]
  /** Значения полей формы, ещё не записанные в байты документа (по имени поля). */
  forms: FormValues
  history: TabSnapshot[]
  future: TabSnapshot[]
  /** Ключ последней правки: подряд идущие правки с тем же ключом (ползунок) — один шаг отмены. */
  coalesce: string | null
  busy: boolean
  /** Защита паролем, которая будет записана в файл; нет — документ без пароля. */
  protection?: DocProtection | null | undefined
}

export interface ZoomState {
  mode: ZoomMode
  percent: number
}

export interface SearchMatch {
  page: number
  match: TextMatch
}

export interface SearchState {
  query: string
  matches: SearchMatch[]
  active: number
  running: boolean
}

export type UpdatePhase =
  'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  info: UpdateInfoSummary | null
  canInstall: boolean
  percent: number
  message: string | null
  confirmInstall: boolean
}

export interface PasswordRequest {
  fileName: string
  reason: PasswordReason
  resolve: (password: string | null) => void
}

// Сравнение
let compareCounter = 0

/** Вторая версия документа для экрана сравнения; живёт, пока открыт этот экран. */
export interface CompareSession {
  /** Растёт с каждым новым сравнением: экран сбрасывает результаты по нему. */
  id: number
  /** Вкладка документа, который сравнивается. */
  baseId: string
  doc: PdfDocument
  name: string
  path: string
}

export const ZOOM_STEPS = [25, 33, 50, 67, 80, 90, 100, 110, 125, 150, 175, 200, 300, 400] as const
export const TOOLS: readonly Tool[] = [
  'select',
  'edit',
  'hand',
  'marker',
  'pen',
  'shapes',
  'text',
  'note',
  'sign'
]
export const TOOL_KEYS: Record<Tool, string> = {
  select: 'V',
  edit: 'E',
  hand: 'H',
  marker: 'M',
  pen: 'P',
  shapes: 'U',
  text: 'T',
  note: 'N',
  sign: 'S'
}
export const MARK_COLORS = ['#ffd86b', '#9be39b', '#9fd3ff', '#ffb0c8', '#d7bfff'] as const
/** Палитра маркера: пастельные цвета выделения и два тёмных для подчёркивания. */
export const MARKER_COLORS = [...MARK_COLORS, '#c42b1c', '#0067c0'] as const
/** Палитра пера, фигур и текста (docs/DESIGN.md §1). */
export const INK_COLORS = ['#1b1b1b', '#c42b1c', '#0067c0', '#0f7b0f', '#ffd86b'] as const
/** Ширина вставленной подписи и наибольшая ширина картинки, пт. */
const SIGNATURE_WIDTH = 150
const IMAGE_MAX_WIDTH = 220

export interface State {
  ready: boolean
  info: AppInfo | null
  settings: AppSettings
  screen: Screen
  docs: DocTab[]
  activeId: string | null
  recent: RecentFile[]
  toast: string | null
  sidebar: boolean
  props: boolean
  sidebarTab: SidebarTab
  zoom: ZoomState
  resolvedZoom: number
  rotation: Rotation
  tool: Tool
  toolStyles: Record<StyledTool, ToolStyle>
  markKind: TextMarkKind
  shapeKind: ShapeKind
  activeSignature: string | null
  contentMode: ContentMode
  contentShift: ContentShift
  /** Несколько выбранных объектов документа (Ctrl+щелчок, рамка с Shift). */
  contentGroup: readonly ContentTarget[]
  /** Стиль нового текста в «Правке»: берётся у последнего выбранного текста документа. */
  contentTextStyle: TextStyle | null
  selection: SelectionTarget | null
  /**
   * Все выбранные объекты «Выделения» (Ctrl+щелчок, рамка с Shift); selection —
   * последний из них. Один объект — группа из него же, без выбора — пусто.
   */
  selectionGroup: readonly SelectionTarget[]
  pagesMode: boolean
  page: number
  scrollRequest: { page: number; token: number } | null
  selectedPages: ReadonlySet<number>
  selectionAnchor: number | null
  search: SearchState
  passwordRequest: PasswordRequest | null
  propertiesOpen: boolean
  closeConfirm: string | null
  // Сравнение
  compare: CompareSession | null
  toolDialog: ToolDialog
  settingsSection: SettingsSection
  update: UpdateState
}

type Action =
  | { type: 'ready'; info: AppInfo; settings: AppSettings; recent: RecentFile[] }
  | { type: 'settings'; settings: AppSettings }
  | { type: 'recent'; recent: RecentFile[] }
  | { type: 'screen'; screen: Screen }
  | { type: 'settingsSection'; section: SettingsSection }
  | { type: 'docOpen'; doc: DocTab }
  | {
      type: 'docReady'
      id: string
      doc: PdfDocument
      bytes: Uint8Array
      fileSize: number
      protection?: DocProtection | null | undefined
    }
  | { type: 'docError'; id: string; error: string }
  | { type: 'docSizes'; id: string }
  | { type: 'docBusy'; id: string; busy: boolean }
  | {
      type: 'docReplace'
      id: string
      doc: PdfDocument
      bytes: Uint8Array
      markup: readonly MarkupObject[]
      forms?: FormValues
      history: TabSnapshot[]
      future: TabSnapshot[]
      dirty: boolean
      selectedPages: ReadonlySet<number>
      protection?: DocProtection | null | undefined
    }
  | {
      type: 'markup'
      id: string
      /** Чистая функция над текущим списком: правки подряд не теряют друг друга. */
      change: (markup: readonly MarkupObject[]) => readonly MarkupObject[]
      coalesce?: string
      select?: SelectionTarget | null
    }
  | {
      type: 'markupRestore'
      id: string
      markup: readonly MarkupObject[]
      forms?: FormValues
      history: TabSnapshot[]
      future: TabSnapshot[]
      protection?: DocProtection | null | undefined
    }
  | {
      type: 'forms'
      id: string
      change: (forms: FormValues) => FormValues
      coalesce?: string
    }
  | { type: 'docSaved'; id: string; path: string }
  | { type: 'closeDoc'; id: string }
  | { type: 'activateDoc'; id: string }
  | { type: 'toast'; message: string | null }
  | { type: 'sidebar'; on?: boolean }
  | { type: 'props'; on?: boolean }
  | { type: 'sidebarTab'; tab: SidebarTab }
  | { type: 'zoom'; zoom: ZoomState }
  | { type: 'resolvedZoom'; percent: number }
  | { type: 'rotation'; rotation: Rotation }
  | { type: 'tool'; tool: Tool }
  | { type: 'toolStyle'; tool: StyledTool; patch: Partial<ToolStyle> }
  | { type: 'markKind'; kind: TextMarkKind }
  | { type: 'shapeKind'; kind: ShapeKind }
  | { type: 'activeSignature'; id: string | null }
  | { type: 'contentMode'; mode: ContentMode }
  | { type: 'contentTextStyle'; patch: Partial<TextStyle> }
  | { type: 'contentShift'; shift: ContentShift }
  | { type: 'contentGroup'; group: readonly ContentTarget[] }
  | { type: 'select'; target: SelectionTarget | null }
  | { type: 'selectGroup'; targets: readonly SelectionTarget[] }
  | { type: 'pagesMode'; on?: boolean }
  | { type: 'page'; page: number; scroll: boolean }
  | { type: 'selection'; pages: ReadonlySet<number>; anchor: number | null }
  | { type: 'search'; search: SearchState }
  | { type: 'password'; request: PasswordRequest | null }
  | { type: 'properties'; open: boolean }
  | { type: 'closeConfirm'; id: string | null }
  // Сравнение
  | { type: 'compareOpen'; session: CompareSession }
  | { type: 'compareClose' }
  | { type: 'toolDialog'; dialog: ToolDialog }
  | { type: 'update'; patch: Partial<UpdateState> }
  // Защита паролем
  | { type: 'protection'; id: string; protection: DocProtection | null }

const EMPTY_SEARCH: SearchState = { query: '', matches: [], active: 0, running: false }

function zoomFromSetting(mode: DefaultZoomMode): ZoomState {
  return mode === 'actual' ? { mode: 'custom', percent: 100 } : { mode, percent: 100 }
}

const initial: State = {
  ready: false,
  info: null,
  settings: createDefaultSettings(),
  screen: 'start',
  docs: [],
  activeId: null,
  recent: [],
  toast: null,
  sidebar: true,
  props: window.innerWidth >= 1100,
  sidebarTab: 'thumbs',
  zoom: { mode: 'fit-width', percent: 100 },
  resolvedZoom: 100,
  rotation: 0,
  tool: 'select',
  toolStyles: {
    marker: { color: MARK_COLORS[0], opacity: 1, width: 1, fontSize: 14 },
    pen: { color: INK_COLORS[0], opacity: 1, width: 2, fontSize: 14 },
    shapes: { color: INK_COLORS[1], opacity: 1, width: 2, fontSize: 14 },
    text: { color: INK_COLORS[0], opacity: 1, width: 1, fontSize: 14 },
    note: { color: NOTE_COLOR, opacity: 1, width: 1, fontSize: 14 }
  },
  markKind: 'highlight',
  shapeKind: 'rect',
  activeSignature: null,
  contentMode: 'objects',
  contentTextStyle: null,
  contentShift: 'page',
  contentGroup: [],
  selection: null,
  selectionGroup: [],
  pagesMode: false,
  page: 1,
  scrollRequest: null,
  selectedPages: new Set(),
  selectionAnchor: null,
  search: EMPTY_SEARCH,
  passwordRequest: null,
  propertiesOpen: false,
  closeConfirm: null,
  // Сравнение
  compare: null,
  toolDialog: null,
  settingsSection: 'general',
  update: {
    phase: 'idle',
    info: null,
    canInstall: false,
    percent: 0,
    message: null,
    confirmInstall: false
  }
}

let scrollToken = 0

function resetView(state: State): State {
  return {
    ...state,
    page: 1,
    scrollRequest: null,
    selectedPages: new Set(),
    selectionAnchor: null,
    search: EMPTY_SEARCH,
    selection: null,
    selectionGroup: [],
    rotation: 0,
    pagesMode: false,
    zoom: zoomFromSetting(state.settings.viewer.defaultZoom)
  }
}

function updateDoc(state: State, id: string, patch: (d: DocTab) => DocTab): State {
  return { ...state, docs: state.docs.map((d) => (d.id === id ? patch(d) : d)) }
}

/**
 * Выбор остаётся, только если выбранный объект ещё есть в разметке. Объект
 * документа от правок разметки не меняется; после новых байтов выбор снимает docReplace.
 */
function keepSelection(
  target: SelectionTarget | null,
  markup: readonly MarkupObject[]
): SelectionTarget | null {
  // Аннотацию документа проверяет слой разметки по списку для новых байтов.
  if (target?.source === 'content' || target?.source === 'annotation') return target
  return target && markup.some((o) => o.id === target.id) ? target : null
}

/** Выбор после правки: из группы уходят исчезнувшие объекты, главный — последний оставшийся. */
function regroup(
  state: State,
  selection: SelectionTarget | null,
  keep: (target: SelectionTarget) => boolean
): Pick<State, 'selection' | 'selectionGroup'> {
  const group = state.selectionGroup.filter(keep)
  const primary = selection && keep(selection) ? selection : (group[group.length - 1] ?? null)
  if (!primary) return { selection: null, selectionGroup: [] }
  return {
    selection: primary,
    selectionGroup: hasTarget(group, primary) ? group : [...group, primary]
  }
}

function textStyleOf(object: PageContentObject): TextStyle | null {
  if (object.kind === 'block') return object.style
  if (object.kind !== 'text') return null
  const { fontName, fontSize, color, bold, italic } = object
  return { fontName, fontSize, color, bold, italic }
}

/** Какой выбор имеет смысл в инструменте: разметка — в «Выделении», документ — в «Правке». */
function selectionForTool(target: SelectionTarget | null, tool: Tool): SelectionTarget | null {
  if ((target?.source === 'markup' || target?.source === 'annotation') && tool === 'select')
    return target
  if (target?.source === 'content' && tool === 'edit') return target
  return null
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ready':
      return {
        ...state,
        ready: true,
        info: action.info,
        settings: action.settings,
        recent: action.recent,
        zoom: zoomFromSetting(action.settings.viewer.defaultZoom)
      }
    case 'settings':
      return { ...state, settings: action.settings }
    case 'recent':
      return { ...state, recent: action.recent }
    case 'screen':
      return { ...state, screen: action.screen }
    case 'settingsSection':
      return { ...state, settingsSection: action.section, screen: 'settings' }
    case 'docOpen':
      return {
        ...resetView(state),
        docs: [...state.docs, action.doc],
        activeId: action.doc.id,
        screen: 'viewer'
      }
    case 'docReady':
      return updateDoc(state, action.id, (d) => ({
        ...d,
        status: 'ready',
        doc: action.doc,
        pages: action.doc.numPages,
        bytes: action.bytes,
        fileSize: action.fileSize,
        error: null,
        protection: action.protection ?? null
      }))
    case 'docError':
      return updateDoc(state, action.id, (d) => ({ ...d, status: 'error', error: action.error }))
    case 'docSizes':
      return updateDoc(state, action.id, (d) => ({ ...d, sizesVersion: d.sizesVersion + 1 }))
    case 'docBusy':
      return updateDoc(state, action.id, (d) => ({ ...d, busy: action.busy }))
    case 'docReplace': {
      const next = updateDoc(state, action.id, (d) => ({
        ...d,
        doc: action.doc,
        pages: action.doc.numPages,
        bytes: action.bytes,
        markup: action.markup,
        forms: action.forms ?? NO_FORMS,
        history: action.history,
        future: action.future,
        coalesce: null,
        dirty: action.dirty,
        busy: false,
        sizesVersion: d.sizesVersion + 1,
        protection: action.protection === undefined ? d.protection : action.protection
      }))
      const page = Math.min(state.page, action.doc.numPages)
      return {
        ...next,
        page,
        selectedPages: action.selectedPages,
        selectionAnchor: null,
        // Строки и картинки документа после новых байтов читаются заново.
        ...regroup(
          state,
          state.selection,
          (target) => target.source !== 'content' && keepSelection(target, action.markup) !== null
        ),
        contentGroup: [],
        search: EMPTY_SEARCH
      }
    }
    case 'markup': {
      const tab = state.docs.find((d) => d.id === action.id)
      const bytes = tab?.bytes
      if (!tab || !bytes || tab.busy) return state
      const markup = action.change(tab.markup)
      if (markup === tab.markup) return state
      const merge = action.coalesce !== undefined && action.coalesce === tab.coalesce
      const next = updateDoc(state, action.id, (d) => ({
        ...d,
        markup,
        history: merge
          ? d.history
          : pushSnapshot(d.history, { bytes, markup: d.markup, forms: d.forms }),
        future: merge ? d.future : [],
        coalesce: action.coalesce ?? null,
        dirty: true
      }))
      if (action.select !== undefined) {
        const target = keepSelection(action.select, markup)
        return { ...next, selection: target, selectionGroup: target ? [target] : [] }
      }
      return {
        ...next,
        ...regroup(state, state.selection, (target) => keepSelection(target, markup) !== null)
      }
    }
    case 'forms': {
      const tab = state.docs.find((d) => d.id === action.id)
      const bytes = tab?.bytes
      if (!tab || !bytes || tab.busy) return state
      const forms = action.change(tab.forms)
      if (forms === tab.forms) return state
      const merge = action.coalesce !== undefined && action.coalesce === tab.coalesce
      const snapshot: TabSnapshot = { bytes, markup: tab.markup, forms: tab.forms }
      return updateDoc(state, action.id, (d) => ({
        ...d,
        forms,
        history: merge ? d.history : pushSnapshot(d.history, snapshot),
        future: merge ? d.future : [],
        coalesce: action.coalesce ?? null,
        dirty: true
      }))
    }
    case 'markupRestore': {
      const next = updateDoc(state, action.id, (d) => ({
        ...d,
        markup: action.markup,
        forms: action.forms ?? d.forms,
        history: action.history,
        future: action.future,
        coalesce: null,
        dirty: true,
        protection: action.protection === undefined ? d.protection : action.protection
      }))
      return {
        ...next,
        ...regroup(
          state,
          state.selection,
          (target) => keepSelection(target, action.markup) !== null
        )
      }
    }
    case 'docSaved':
      return updateDoc(state, action.id, (d) => ({
        ...d,
        dirty: false,
        path: action.path,
        name: basenameOf(action.path)
      }))
    case 'closeDoc': {
      const index = state.docs.findIndex((d) => d.id === action.id)
      const closing = state.docs[index]
      closing?.doc?.destroy()
      const docs = state.docs.filter((d) => d.id !== action.id)
      let activeId = state.activeId
      if (activeId === action.id) activeId = (docs[index] ?? docs[index - 1])?.id ?? null
      const next = activeId !== state.activeId ? resetView(state) : state
      return {
        ...next,
        docs,
        activeId,
        closeConfirm: state.closeConfirm === action.id ? null : state.closeConfirm,
        screen: activeId === null && state.screen === 'viewer' ? 'start' : state.screen
      }
    }
    case 'activateDoc':
      return action.id === state.activeId
        ? { ...state, screen: 'viewer' }
        : { ...resetView(state), activeId: action.id, screen: 'viewer' }
    case 'toast':
      return { ...state, toast: action.message }
    case 'sidebar':
      return { ...state, sidebar: action.on ?? !state.sidebar }
    case 'props':
      return { ...state, props: action.on ?? !state.props }
    case 'sidebarTab':
      return { ...state, sidebarTab: action.tab, sidebar: true }
    case 'zoom':
      return {
        ...state,
        zoom: action.zoom,
        resolvedZoom: action.zoom.mode === 'custom' ? action.zoom.percent : state.resolvedZoom
      }
    case 'resolvedZoom':
      return { ...state, resolvedZoom: action.percent }
    case 'rotation':
      return { ...state, rotation: action.rotation }
    case 'tool':
      return {
        ...state,
        tool: action.tool,
        ...regroup(
          state,
          state.selection,
          (target) => selectionForTool(target, action.tool) !== null
        )
      }
    case 'toolStyle':
      return {
        ...state,
        toolStyles: {
          ...state.toolStyles,
          [action.tool]: { ...state.toolStyles[action.tool], ...action.patch }
        }
      }
    case 'markKind':
      return { ...state, markKind: action.kind }
    case 'shapeKind':
      return { ...state, shapeKind: action.kind }
    case 'activeSignature':
      return { ...state, activeSignature: action.id }
    case 'contentMode':
      return {
        ...state,
        contentMode: action.mode,
        selection: action.mode === 'objects' ? state.selection : null,
        contentGroup: action.mode === 'objects' ? state.contentGroup : [],
        selectionGroup: action.mode === 'objects' ? state.selectionGroup : []
      }
    case 'contentShift':
      return { ...state, contentShift: action.shift }
    case 'contentGroup': {
      // Главный объект группы — последний добавленный: его показывает панель.
      const primary = action.group[action.group.length - 1] ?? null
      return {
        ...state,
        contentGroup: action.group.length > 1 ? action.group : [],
        selectionGroup: [],
        selection: primary,
        contentTextStyle: (primary && textStyleOf(primary.object)) ?? state.contentTextStyle
      }
    }
    case 'contentTextStyle':
      return state.contentTextStyle
        ? { ...state, contentTextStyle: { ...state.contentTextStyle, ...action.patch } }
        : state
    case 'select': {
      if (sameTarget(state.selection, action.target) && state.selectionGroup.length <= 1)
        return state
      // Выбранный текст документа задаёт стиль нового текста в «Правке».
      const style = action.target?.source === 'content' ? textStyleOf(action.target.object) : null
      return {
        ...state,
        selection: action.target,
        contentGroup: [],
        selectionGroup: action.target ? [action.target] : [],
        contentTextStyle: style ?? state.contentTextStyle
      }
    }
    case 'selectGroup':
      return {
        ...state,
        selection: action.targets[action.targets.length - 1] ?? null,
        selectionGroup: action.targets
      }
    case 'pagesMode':
      return { ...state, pagesMode: action.on ?? !state.pagesMode }
    case 'page':
      return {
        ...state,
        page: action.page,
        scrollRequest: action.scroll
          ? { page: action.page, token: ++scrollToken }
          : state.scrollRequest
      }
    case 'selection':
      return { ...state, selectedPages: action.pages, selectionAnchor: action.anchor }
    case 'search':
      return { ...state, search: action.search }
    case 'password':
      return { ...state, passwordRequest: action.request }
    case 'properties':
      return { ...state, propertiesOpen: action.open }
    case 'closeConfirm':
      return { ...state, closeConfirm: action.id }
    // Сравнение
    case 'compareOpen':
      return { ...state, compare: action.session, screen: 'compare' }
    case 'compareClose':
      return {
        ...state,
        compare: null,
        screen:
          state.screen === 'compare' ? (state.activeId === null ? 'start' : 'viewer') : state.screen
      }
    case 'toolDialog':
      return { ...state, toolDialog: action.dialog }
    case 'update':
      return { ...state, update: { ...state.update, ...action.patch } }
    // Защита паролем
    case 'protection': {
      const tab = state.docs.find((d) => d.id === action.id)
      const bytes = tab?.bytes
      if (!tab || !bytes || tab.busy) return state
      const snapshot: TabSnapshot = {
        bytes,
        markup: tab.markup,
        forms: tab.forms,
        protection: tab.protection ?? null
      }
      return updateDoc(state, action.id, (d) => ({
        ...d,
        protection: action.protection,
        history: pushSnapshot(d.history, snapshot),
        future: [],
        coalesce: null,
        dirty: true
      }))
    }
  }
}

export interface Actions {
  // Окна и сессия
  /** Переносит вкладку в новое окно; несохранённый документ с saveFirst сначала сохраняется. */
  openInNewWindow: (id: string, saveFirst?: boolean) => void
  go: (screen: Screen) => void
  openSettings: (section?: SettingsSection) => void
  openDialog: () => Promise<void>
  openPath: (path: string) => void
  openFiles: (files: FileList | File[]) => void
  requestCloseDoc: (id?: string) => void
  confirmClose: (choice: 'save' | 'discard' | 'cancel') => void
  activateDoc: (id: string) => void
  removeRecent: (path: string) => void
  updateSettings: (patch: SettingsPatch) => Promise<void>
  cycleTheme: () => void
  /** Сохраняет язык и перезагружает окна на нём (если нет несохранённых правок). */
  setLanguage: (language: Language) => void
  toast: (message: string) => void
  zoomBy: (delta: 1 | -1) => void
  zoomTo: (percent: number) => void
  setZoomMode: (mode: ZoomMode) => void
  cycleZoomMode: () => void
  setResolvedZoom: (percent: number) => void
  rotate: () => void
  setTool: (tool: Tool) => void
  setToolStyle: (tool: StyledTool, patch: Partial<ToolStyle>) => void
  setMarkKind: (kind: TextMarkKind) => void
  setShapeKind: (kind: ShapeKind) => void
  // Разметка
  addMarkup: (object: MarkupObject, select?: boolean) => void
  /** Заменяет объект с тем же id; coalesce склеивает серию правок в один шаг отмены. */
  updateMarkup: (object: MarkupObject, coalesce?: string) => void
  removeMarkup: (id?: string) => void
  select: (target: SelectionTarget | null) => void
  setSaveMode: (mode: MarkupSaveMode) => void
  addSignature: (src: string) => void
  removeSignature: (id: string) => void
  setActiveSignature: (id: string) => void
  /** Ставит выбранную подпись на страницу: в точку center или в центр страницы. */
  placeSignature: (page: number, center: Point | null) => void
  insertImage: (file: File) => void
  // Правка содержимого документа (MuPDF)
  setContentMode: (mode: ContentMode) => void
  /** Delete: удаляет выбранный объект разметки или объект документа. */
  removeSelected: () => void
  replaceContentText: (
    page: number,
    line: PageTextLine,
    text: string,
    style?: TextStylePatch
  ) => void
  /** Переписывает абзац: текст, ширина колонки, новое начало, стиль. */
  replaceContentBlock: (
    page: number,
    block: PageTextBlock,
    text: string,
    options?: { width?: number; origin?: PdfSpacePoint; style?: TextStylePatch }
  ) => void
  insertContentText: (
    page: number,
    origin: PdfSpacePoint,
    text: string,
    style: TextStyle,
    options?: { width?: number; direction?: PdfSpacePoint }
  ) => void
  setContentTextStyle: (patch: Partial<TextStyle>) => void
  removeContent: (page: number, object: PageContentObject) => void
  moveContentGraphic: (page: number, graphic: PageGraphic, rect: PdfSpaceRect) => void
  setContentShift: (shift: ContentShift) => void
  /** Группа выбранных объектов документа; пустая или из одного — обычный выбор. */
  setContentGroup: (group: readonly ContentTarget[]) => void
  /** Сдвигает все объекты группы на delta (пространство PDF). */
  moveContentGroup: (group: readonly ContentTarget[], delta: PdfSpacePoint) => void
  replaceContentImage: (page: number, image: PageImage, file: File) => void
  moveContentImage: (page: number, image: PageImage, rect: PdfSpaceRect) => void
  eraseContent: (page: number, rect: PdfSpaceRect) => void
  // Формы и метаданные
  /** Значение поля формы; coalesce склеивает набор текста в один шаг отмены. */
  setFormValue: (name: string, value: FormValue, coalesce?: string) => void
  /** Отменяет несохранённые значения полей: поля снова как в файле. */
  resetForms: () => void
  /** Вплавляет поля в страницы: значения остаются, полей больше нет. */
  flattenForms: () => void
  setMetadata: (patch: Partial<DocumentMetadata>) => Promise<boolean>
  clearMetadata: () => Promise<boolean>
  // Аннотации документа
  /** Ctrl+щелчок: добавляет объект к выбору или убирает его оттуда. */
  toggleSelected: (target: SelectionTarget) => void
  /** Выбор рамкой: ровно эти объекты (пустой список снимает выбор). */
  selectGroup: (targets: readonly SelectionTarget[]) => void
  /** Сдвигает выбранные объекты разметки и аннотации документа одним шагом отмены, пт. */
  moveSelected: (dx: number, dy: number) => void
  /** Правка аннотации документа: рамка, цвет, непрозрачность или текст. */
  editAnnotation: (page: number, index: number, patch: AnnotationPatch) => void
  togglePagesMode: (on?: boolean) => void
  setSidebarTab: (tab: SidebarTab) => void
  toggleSidebar: (on?: boolean) => void
  toggleProps: (on?: boolean) => void
  setPage: (page: number) => void
  pageFromScroll: (page: number) => void
  selectPage: (page: number, mode: SelectMode) => void
  selectAll: () => void
  selectNone: () => void
  search: (query: string) => void
  searchStep: (delta: 1 | -1) => void
  searchGo: (index: number) => void
  openProperties: () => void
  closeProperties: () => void
  print: () => void
  openExternal: (url: string) => void
  focusSearch: () => void
  // Правка страниц
  rotateSelected: (delta: 90 | 270) => void
  deleteSelected: () => void
  duplicateSelected: () => void
  insertBlank: () => void
  insertFromFile: () => void
  extractSelected: () => void
  movePages: (target: number) => void
  undo: () => void
  redo: () => void
  save: () => Promise<boolean>
  saveAs: () => Promise<boolean>
  // Сравнение
  /** Выбирает второй PDF и открывает экран сравнения с активным документом. */
  compareWith: () => void
  /** Закрывает сравнение и возвращает к документу. */
  closeCompare: () => void
  // Распознавание текста
  /**
   * Дописывает к активному документу невидимый текстовый слой шагом истории:
   * нумерация страниц не меняется, несохранённая разметка остаётся объектами.
   */
  applyTextLayer: (
    run: (bytes: Uint8Array) => Promise<Uint8Array>,
    message: string
  ) => Promise<boolean>
  openTool: (dialog: ToolDialog) => void
  // Конвертация
  /** Активный документ как источник: байты с записанной несохранённой разметкой. */
  convertSource: () => Promise<ConvertSource | null>
  /** Открывает готовые байты новой несохранённой вкладкой («Сохранить» спросит путь). */
  openNewDocument: (name: string, bytes: Uint8Array) => Promise<boolean>
  /** Заменяет байты активного документа шагом истории: Ctrl+Z возвращает прежние. */
  replaceDocument: (bytes: Uint8Array, message: string) => Promise<boolean>
  // Защита паролем
  /** Задаёт пароль документа шагом истории; файл шифруется при записи. */
  setProtection: (options: ProtectOptions) => void
  /** Снимает защиту шагом истории: файл запишется без пароля. */
  removeProtection: () => void
  checkUpdates: () => void
  downloadUpdate: () => void
  cancelUpdate: () => void
  installUpdate: (confirmed: boolean) => void
}

interface Store {
  state: State
  actions: Actions
  api: PdfwrightApi
  searchRef: React.RefObject<HTMLInputElement | null>
}

const StoreContext = createContext<Store | null>(null)

export function activeDoc(state: State): DocTab | null {
  return state.docs.find((d) => d.id === state.activeId) ?? null
}

export function selectedList(state: State): number[] {
  return [...state.selectedPages].sort((a, b) => a - b)
}

let docCounter = 0

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const api = useMemo(() => getApi(), [])
  const [state, dispatch] = useReducer(reducer, initial)
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  })
  const searchRef = useRef<HTMLInputElement | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const searchRun = useRef(0)

  const toast = useCallback((message: string) => {
    dispatch({ type: 'toast', message })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => {
      dispatch({ type: 'toast', message: null })
    }, 2600)
  }, [])

  const refreshRecent = useCallback(() => {
    api
      .getRecentFiles()
      .then((recent) => {
        dispatch({ type: 'recent', recent })
      })
      .catch(() => undefined)
  }, [api])

  const openPath = useCallback(
    (path: string): string => {
      const existing = stateRef.current.docs.find((d) => d.path === path)
      if (existing && existing.status !== 'error') {
        dispatch({ type: 'activateDoc', id: existing.id })
        return existing.id
      }
      if (existing) dispatch({ type: 'closeDoc', id: existing.id })
      docCounter += 1
      const id = `doc-${docCounter}`
      const name = basenameOf(path)
      dispatch({
        type: 'docOpen',
        doc: {
          id,
          name,
          path,
          status: 'loading',
          doc: null,
          pages: 0,
          fileSize: 0,
          error: null,
          sizesVersion: 0,
          bytes: null,
          dirty: false,
          markup: [],
          forms: NO_FORMS,
          history: [],
          future: [],
          coalesce: null,
          busy: false
        }
      })
      // Пароль, которым открыт документ, нужен для записи с тем же шифрованием.
      let typed: string | null = null
      const askPassword = (reason: PasswordReason): Promise<string | null> =>
        new Promise((resolve) => {
          dispatch({
            type: 'password',
            request: {
              fileName: name,
              reason,
              resolve: (password) => {
                dispatch({ type: 'password', request: null })
                typed = password
                resolve(password)
              }
            }
          })
        })
      void (async () => {
        try {
          const file = await api.readFile(path)
          const doc = await loadPdfDocument(new Uint8Array(file.bytes), { askPassword })
          const { bytes, protection } = await unlockOpened(doc, new Uint8Array(file.bytes), typed)
          if (!stateRef.current.docs.some((d) => d.id === id)) {
            doc.destroy()
            return
          }
          dispatch({ type: 'docReady', id, doc, bytes, fileSize: file.size, protection })
          console.info(`[pdfwright] документ открыт: ${name}, страниц: ${doc.numPages}`)
          void doc.loadSizes(() => {
            dispatch({ type: 'docSizes', id })
          })
        } catch (error) {
          if (error instanceof PdfLoadError && error.kind === 'cancelled') {
            dispatch({ type: 'closeDoc', id })
            return
          }
          const message = error instanceof Error ? error.message : String(error)
          dispatch({ type: 'docError', id, error: message })
        } finally {
          refreshRecent()
        }
      })()
      return id
    },
    [api, refreshRecent]
  )

  useEffect(() => {
    void Promise.all([
      api.getAppInfo(),
      api.getSettings(),
      api.getRecentFiles().catch(() => [])
    ]).then(([info, settings, recent]) => {
      applyTheme(settings.general.theme)
      dispatch({ type: 'ready', info, settings, recent })
      void api.takeStartupFiles().then(({ files, active, missing }) => {
        const ids = files.map((path) => openPath(path))
        const activeId = active === null ? undefined : ids[files.indexOf(active)]
        if (activeId !== undefined) dispatch({ type: 'activateDoc', id: activeId })
        if (missing.length > 0) toast(t.windows.missing(missing.map(basenameOf).join(', ')))
      })
    })
    const unsubscribeOpen = api.onOpenFile(openPath)
    const unsubscribeProgress = api.onUpdateProgress((progress) => {
      dispatch({ type: 'update', patch: { phase: 'downloading', percent: progress.percent } })
    })
    return () => {
      unsubscribeOpen()
      unsubscribeProgress()
    }
  }, [api, openPath, toast])

  // main спрашивает подтверждение при закрытии окна, если есть несохранённые документы.
  const dirtyCount = state.docs.filter((d) => d.dirty).length
  useEffect(() => {
    api.setDirtyCount(dirtyCount).catch(() => undefined)
  }, [api, dirtyCount])

  // main запоминает вкладки окна для сеанса и для выбора окна под файл из Проводника.
  const tabPaths = state.docs
    .filter((d) => d.status !== 'error')
    .map((d) => d.path)
    .join('\n')
  const activePath = activeDoc(state)?.path ?? null
  useEffect(() => {
    api
      .setWindowTabs({ paths: tabPaths === '' ? [] : tabPaths.split('\n'), active: activePath })
      .catch(() => undefined)
  }, [api, tabPaths, activePath])

  const updateSettings = useCallback(
    async (patch: SettingsPatch) => {
      const settings = await api.updateSettings(patch)
      applyTheme(settings.general.theme)
      dispatch({ type: 'settings', settings })
    },
    [api]
  )

  const openDialog = useCallback(async () => {
    const file = await api.openPdfDialog()
    if (file) openPath(file.path)
  }, [api, openPath])

  /**
   * Байты документа с записанными в них несохранёнными значениями полей формы
   * (вид полей — шрифтом PT Sans) и разметкой (режим из настроек).
   */
  const bakeMarkup = useCallback(async (tab: DocTab): Promise<Uint8Array> => {
    let bytes = tab.bytes ?? new Uint8Array()
    if (hasForms(tab)) {
      bytes = await applyFormValues(bytes, tab.forms, { font: (await loadMarkupFont()).bytes })
    }
    if (tab.markup.length === 0) return bytes
    const font = tab.markup.some((o) => o.kind === 'text') ? (await loadMarkupFont()).bytes : null
    return applyMarkup(bytes, tab.markup, {
      mode: stateRef.current.settings.markup.saveMode,
      font
    })
  }, [])

  /**
   * Применяет операцию pdf-lib к активному документу: новые байты, перезагрузка
   * просмотра, запись в историю отмены. Селекция после операции задаётся явно.
   * Несохранённая разметка сначала записывается в документ: номера страниц
   * после операции меняются, а записанные аннотации переезжают вместе со страницами.
   */
  const applyOperation = useCallback(
    async (
      run: (bytes: Uint8Array) => Promise<Uint8Array>,
      options: {
        message?: string
        select?: (order: number[] | null) => ReadonlySet<number>
        order?: number[]
        /**
         * Правка содержимого страницы: нумерация страниц не меняется, поэтому
         * несохранённая разметка остаётся редактируемыми объектами поверх.
         */
        keepMarkup?: boolean
        /** Разметка после операции (с keepMarkup): перенос группы — один шаг отмены. */
        markup?: readonly MarkupObject[]
      } = {}
    ): Promise<boolean> => {
      const tab = activeDoc(stateRef.current)
      if (tab?.status !== 'ready' || !tab.bytes || tab.busy) return false
      dispatch({ type: 'docBusy', id: tab.id, busy: true })
      try {
        const bytes = await run(options.keepMarkup ? tab.bytes : await bakeMarkup(tab))
        const doc = await loadPdfDocument(bytes, { askPassword: () => Promise.resolve(null) })
        const previous = tab.doc
        const snapshot: TabSnapshot = { bytes: tab.bytes, markup: tab.markup, forms: tab.forms }
        const history = pushSnapshot(tab.history, snapshot)
        dispatch({
          type: 'docReplace',
          id: tab.id,
          doc,
          bytes,
          markup: options.keepMarkup ? (options.markup ?? tab.markup) : [],
          forms: options.keepMarkup ? tab.forms : NO_FORMS,
          history,
          future: [],
          dirty: true,
          selectedPages: options.select
            ? options.select(options.order ?? null)
            : options.keepMarkup
              ? stateRef.current.selectedPages
              : new Set()
        })
        previous?.destroy()
        void doc.loadSizes(() => {
          dispatch({ type: 'docSizes', id: tab.id })
        })
        if (options.message !== undefined) toast(options.message)
        return true
      } catch (error) {
        dispatch({ type: 'docBusy', id: tab.id, busy: false })
        toast(`${t.ops.failed}: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    },
    [bakeMarkup, toast]
  )

  const restoreSnapshot = useCallback(
    async (direction: 'undo' | 'redo') => {
      const tab = activeDoc(stateRef.current)
      if (tab?.status !== 'ready' || !tab.bytes || tab.busy) return
      const source = direction === 'undo' ? tab.history : tab.future
      const snapshot = source[source.length - 1]
      if (!snapshot) return
      const current: TabSnapshot = {
        bytes: tab.bytes,
        markup: tab.markup,
        forms: tab.forms,
        protection: tab.protection ?? null
      }
      const history = direction === 'undo' ? tab.history.slice(0, -1) : [...tab.history, current]
      const future = direction === 'undo' ? [...tab.future, current] : tab.future.slice(0, -1)
      // Шаг разметки: байты те же, документ не перезагружаем.
      if (snapshot.bytes === tab.bytes) {
        dispatch({
          type: 'markupRestore',
          id: tab.id,
          markup: snapshot.markup,
          forms: snapshot.forms ?? NO_FORMS,
          history,
          future,
          protection: snapshot.protection
        })
        // Шаг защиты паролем ничего не меняет на экране — сообщаем о нём.
        if (snapshot.protection !== undefined && snapshot.protection !== (tab.protection ?? null)) {
          toast(direction === 'undo' ? t.ops.undone : t.ops.redone)
        }
        return
      }
      const { bytes } = snapshot
      dispatch({ type: 'docBusy', id: tab.id, busy: true })
      try {
        const doc = await loadPdfDocument(bytes, { askPassword: () => Promise.resolve(null) })
        const previous = tab.doc
        dispatch({
          type: 'docReplace',
          id: tab.id,
          doc,
          bytes,
          markup: snapshot.markup,
          forms: snapshot.forms ?? NO_FORMS,
          history,
          future,
          dirty: true,
          selectedPages: new Set(),
          protection: snapshot.protection
        })
        previous?.destroy()
        void doc.loadSizes(() => {
          dispatch({ type: 'docSizes', id: tab.id })
        })
        toast(direction === 'undo' ? t.ops.undone : t.ops.redone)
      } catch (error) {
        dispatch({ type: 'docBusy', id: tab.id, busy: false })
        toast(`${t.ops.failed}: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [toast]
  )

  const writeTab = useCallback(
    async (tab: DocTab, path: string): Promise<boolean> => {
      if (!tab.bytes) return false
      try {
        let bytes = tab.bytes
        if (tab.markup.length > 0 || hasForms(tab)) {
          // Разметка и значения полей записываются в документ отдельным шагом
          // истории: Ctrl+Z после сохранения возвращает их в редактируемые.
          dispatch({ type: 'docBusy', id: tab.id, busy: true })
          try {
            bytes = await bakeMarkup(tab)
            const doc = await loadPdfDocument(bytes, { askPassword: () => Promise.resolve(null) })
            const previous = tab.doc
            dispatch({
              type: 'docReplace',
              id: tab.id,
              doc,
              bytes,
              markup: [],
              forms: NO_FORMS,
              history: pushSnapshot(tab.history, {
                bytes: tab.bytes,
                markup: tab.markup,
                forms: tab.forms
              }),
              future: [],
              dirty: true,
              selectedPages: stateRef.current.selectedPages
            })
            previous?.destroy()
            void doc.loadSizes(() => {
              dispatch({ type: 'docSizes', id: tab.id })
            })
          } catch (error) {
            dispatch({ type: 'docBusy', id: tab.id, busy: false })
            throw error
          }
        }
        // Защита паролем: в файл идут зашифрованные байты.
        const output = await lockForWrite(tab.protection, bytes)
        await api.writeFile({
          path,
          bytes: toArrayBuffer(output),
          backup: stateRef.current.settings.files.backupOnSave
        })
        dispatch({ type: 'docSaved', id: tab.id, path })
        toast(t.ops.saved(basenameOf(path)))
        refreshRecent()
        return true
      } catch (error) {
        toast(`${t.ops.failed}: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    },
    [api, bakeMarkup, refreshRecent, toast]
  )

  const save = useCallback(async (): Promise<boolean> => {
    const tab = activeDoc(stateRef.current)
    if (tab?.status !== 'ready' || tab.busy) return false
    if (tab.path === '') {
      const path = await api.savePdfDialog({ title: t.ops.saveAsTitle, defaultPath: tab.name })
      return path === null ? false : writeTab(tab, path)
    }
    return writeTab(tab, tab.path)
  }, [api, writeTab])

  const saveAs = useCallback(async (): Promise<boolean> => {
    const tab = activeDoc(stateRef.current)
    if (tab?.status !== 'ready' || tab.busy) return false
    const path = await api.savePdfDialog({
      title: t.ops.saveAsTitle,
      defaultPath: tab.path || tab.name
    })
    if (path === null) return false
    return writeTab(tab, path)
  }, [api, writeTab])

  /** Правка содержимого документа на MuPDF: новые байты, шаг истории, разметка остаётся. */
  const editContent = useCallback(
    (kind: ContentEditKind, run: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<boolean> =>
      applyOperation(run, { keepMarkup: true, message: t.content.done[kind] }),
    [applyOperation]
  )

  const addMarkup = useCallback((object: MarkupObject, select = true) => {
    const tab = activeDoc(stateRef.current)
    if (tab?.status !== 'ready') return
    dispatch({
      type: 'markup',
      id: tab.id,
      change: (markup) => [...markup, object],
      ...(select ? { select: { source: 'markup' as const, id: object.id } } : {})
    })
  }, [])

  /**
   * Ставит картинку на страницу с сохранением пропорций: ширина не больше
   * maxWidth и половины страницы, содержимое выпрямлено под /Rotate страницы.
   */
  const placeImage = useCallback(
    async (
      src: string,
      page: number,
      center: Point | null,
      maxWidth: number,
      signature: boolean
    ): Promise<boolean> => {
      const tab = activeDoc(stateRef.current)
      const doc = tab?.doc
      if (tab?.status !== 'ready' || !doc) return false
      const natural = await imageSize(src)
      const { box, rotate: pageRotate } = doc.geometryOf(page)
      // Картинка встаёт ровно на экране: с учётом /Rotate страницы и поворота вида.
      const rotate = normalizeTurn(pageRotate + stateRef.current.rotation)
      const sideways = rotate === 90 || rotate === 270
      const pageWidth = sideways ? box[3] - box[1] : box[2] - box[0]
      const width = Math.min(maxWidth, pageWidth / 2, natural.width)
      const height = (width * natural.height) / natural.width
      const at = center ?? { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 }
      // Подпись, поставленная щелчком у края, целиком остаётся на странице.
      const inside = (rect: Rect): Rect => {
        const fix = shiftInside(rect, box)
        return { ...rect, x: rect.x + fix.x, y: rect.y + fix.y }
      }
      addMarkup({
        id: newMarkupId(),
        page,
        kind: 'image',
        color: '#000000',
        opacity: 1,
        rect: inside(boxRectCentered(at, width, height, rotate)),
        rotate,
        src,
        signature
      })
      return true
    },
    [addMarkup]
  )

  const runSearch = useCallback((query: string) => {
    const run = ++searchRun.current
    const tab = activeDoc(stateRef.current)
    const doc = tab?.doc
    const trimmed = query.trim()
    if (!doc || trimmed.length === 0) {
      dispatch({ type: 'search', search: { ...EMPTY_SEARCH, query: trimmed } })
      return
    }
    dispatch({ type: 'search', search: { query: trimmed, matches: [], active: 0, running: true } })
    void (async () => {
      const matches: SearchMatch[] = []
      let firstJumped = false
      for (let page = 1; page <= doc.numPages; page += 1) {
        if (searchRun.current !== run) return
        const items = await doc.getTextItems(page)
        if (searchRun.current !== run) return
        for (const match of findMatches(items, trimmed)) matches.push({ page, match })
        if (page % 10 === 0 || page === doc.numPages) {
          dispatch({
            type: 'search',
            search: {
              query: trimmed,
              matches: [...matches],
              active: 0,
              running: page < doc.numPages
            }
          })
        }
        if (!firstJumped && matches.length > 0) {
          firstJumped = true
          const first = matches[0]
          if (first) dispatch({ type: 'page', page: first.page, scroll: true })
        }
      }
    })()
  }, [])

  const actions = useMemo<Actions>(() => {
    const selectedOf = (): number[] => selectedList(stateRef.current)
    const insertAfter = (): number => {
      const sel = selectedOf()
      const tab = activeDoc(stateRef.current)
      return sel.length > 0 ? (sel[sel.length - 1] ?? 0) : (tab?.pages ?? 0)
    }
    const rangeSelect = (count: number, from: number): ReadonlySet<number> =>
      new Set(Array.from({ length: count }, (_, i) => from + i))
    const removeMarkupObject = (target: string): void => {
      const tab = activeDoc(stateRef.current)
      if (tab?.status !== 'ready') return
      dispatch({
        type: 'markup',
        id: tab.id,
        change: (markup) =>
          markup.some((o) => o.id === target) ? markup.filter((o) => o.id !== target) : markup,
        select: null
      })
    }
    /**
     * Удаляет группу объектов одним шагом отмены. Абзацы удаляются без сдвига
     * содержимого ниже — иначе остальные объекты группы сместились бы и не нашлись.
     * Объект, исчезнувший вместе с предыдущим (строка удалённого абзаца), пропускается.
     */
    const removeContentGroup = (group: readonly ContentTarget[]): void => {
      void editContent('removeGroup', async (bytes) => {
        let next = bytes
        let removed = 0
        let failure: Error | null = null
        for (const target of group) {
          const index = target.page - 1
          const o = target.object
          try {
            if (o.kind === 'text') next = await pdfContent.removeTextLine(next, index, o)
            else if (o.kind === 'block')
              next = await pdfContent.replaceBlock(next, index, { lines: o.refs }, '', {
                shift: 'none'
              })
            else if (o.kind === 'image') next = await pdfContent.removeImage(next, index, o)
            else next = await pdfContent.removeGraphic(next, index, o)
            removed += 1
          } catch (error) {
            failure ??= error instanceof Error ? error : new Error(String(error))
          }
        }
        if (removed === 0 && failure !== null) throw failure
        return next
      })
    }
    const removeContentObject = (page: number, object: PageContentObject): void => {
      const index = page - 1
      switch (object.kind) {
        case 'text':
          void editContent('removeLine', (bytes) => pdfContent.removeTextLine(bytes, index, object))
          break
        case 'block':
          void editContent('removeBlock', (bytes) =>
            pdfContent.replaceBlock(bytes, index, { lines: object.refs }, '', {
              shift: stateRef.current.contentShift
            })
          )
          break
        case 'image':
          void editContent('removeImage', (bytes) => pdfContent.removeImage(bytes, index, object))
          break
        case 'graphic':
          void editContent('removeGraphic', (bytes) =>
            pdfContent.removeGraphic(bytes, index, object)
          )
          break
      }
    }

    // Аннотации документа
    /** Объекты аннотаций для движка: по месту в списке для текущих байтов. */
    const resolveAnnotations = async (
      bytes: Uint8Array,
      targets: readonly SelectionTarget[]
    ): Promise<{ pageIndex: number; annotation: PageAnnotation }[]> => {
      const found: { pageIndex: number; annotation: PageAnnotation }[] = []
      for (const target of targets) {
        if (target.source !== 'annotation') continue
        const annotation = await findAnnotation(bytes, target.page, target.index)
        if (annotation?.subtype === target.subtype) {
          found.push({ pageIndex: target.page - 1, annotation })
        }
      }
      return found
    }
    /** Удаляет выбранные объекты разметки и аннотации документа одним шагом отмены. */
    const removeTargets = (targets: readonly SelectionTarget[]): void => {
      const tab = activeDoc(stateRef.current)
      const bytes = tab?.bytes
      if (tab?.status !== 'ready' || !bytes || tab.busy) return
      const ids = new Set(targets.filter((x) => x.source === 'markup').map((x) => x.id))
      const keep = (markup: readonly MarkupObject[]): readonly MarkupObject[] =>
        markup.filter((o) => !ids.has(o.id))
      const count = targets.length
      if (!targets.some((x) => x.source === 'annotation')) {
        dispatch({ type: 'markup', id: tab.id, change: keep, select: null })
        if (count > 1) toast(t.annotations.removed(count))
        return
      }
      void (async () => {
        try {
          const found = await resolveAnnotations(bytes, targets)
          dispatch({ type: 'select', target: null })
          await applyOperation((current) => pdfContent.removeAnnotations(current, found), {
            keepMarkup: true,
            markup: keep(activeDoc(stateRef.current)?.markup ?? tab.markup),
            ...(count > 1 ? { message: t.annotations.removed(count) } : {})
          })
        } catch (error) {
          toast(`${t.ops.failed}: ${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    }

    return {
      // Окна и сессия
      openInNewWindow: (id, saveFirst = false) => {
        void (async () => {
          const tab = stateRef.current.docs.find((d) => d.id === id)
          if (!tab || tab.status === 'error') return
          // Новое окно читает документ с диска: несохранённые правки туда не попадут.
          if (tab.dirty && !(saveFirst && (await writeTab(tab, tab.path)))) return
          try {
            await api.openInNewWindow(tab.path)
            dispatch({ type: 'closeDoc', id })
          } catch (error) {
            toast(`${t.ops.failed}: ${error instanceof Error ? error.message : String(error)}`)
          }
        })()
      },
      go: (screen) => {
        dispatch({ type: 'screen', screen })
      },
      openSettings: (section = 'general') => {
        dispatch({ type: 'settingsSection', section })
      },
      openDialog,
      openPath,
      openFiles: (files) => {
        for (const file of Array.from(files)) {
          if (!/\.pdf$/i.test(file.name)) continue
          try {
            openPath(api.getPathForFile(file))
          } catch {
            toast(t.toast.dropFailed)
          }
        }
      },
      requestCloseDoc: (id) => {
        const target = id ?? stateRef.current.activeId
        if (target === null) return
        const tab = stateRef.current.docs.find((d) => d.id === target)
        if (tab?.dirty) dispatch({ type: 'closeConfirm', id: target })
        else dispatch({ type: 'closeDoc', id: target })
      },
      confirmClose: (choice) => {
        const id = stateRef.current.closeConfirm
        if (id === null) return
        if (choice === 'cancel') {
          dispatch({ type: 'closeConfirm', id: null })
          return
        }
        if (choice === 'discard') {
          dispatch({ type: 'closeDoc', id })
          return
        }
        dispatch({ type: 'activateDoc', id })
        void save().then((ok) => {
          if (ok) dispatch({ type: 'closeDoc', id })
          else dispatch({ type: 'closeConfirm', id: null })
        })
      },
      activateDoc: (id) => {
        dispatch({ type: 'activateDoc', id })
      },
      removeRecent: (path) => {
        api
          .removeRecentFile(path)
          .then((recent) => {
            dispatch({ type: 'recent', recent })
          })
          .catch(() => undefined)
      },
      updateSettings,
      setLanguage: (language) => {
        void (async () => {
          await updateSettings({ general: { language } })
          const result = await api.applyLanguage()
          if (!result.applied) toast(t.settings.languageLater(result.dirty))
        })()
      },
      cycleTheme: () => {
        const next: Theme = resolvedTheme() === 'dark' ? 'light' : 'dark'
        void updateSettings({ general: { theme: next } })
      },
      toast,
      zoomBy: (delta) => {
        const current = stateRef.current.resolvedZoom
        const next =
          delta > 0
            ? ZOOM_STEPS.find((step) => step > current)
            : [...ZOOM_STEPS].reverse().find((step) => step < current)
        if (next !== undefined) dispatch({ type: 'zoom', zoom: { mode: 'custom', percent: next } })
      },
      zoomTo: (percent) => {
        dispatch({ type: 'zoom', zoom: { mode: 'custom', percent } })
      },
      setZoomMode: (mode) => {
        dispatch({ type: 'zoom', zoom: { mode, percent: stateRef.current.resolvedZoom } })
      },
      cycleZoomMode: () => {
        const order: ZoomMode[] = ['fit-width', 'fit-page', 'custom']
        const index = order.indexOf(stateRef.current.zoom.mode)
        const mode = order[(index + 1) % order.length] ?? 'fit-width'
        dispatch({ type: 'zoom', zoom: { mode, percent: 100 } })
        toast(
          mode === 'fit-width'
            ? t.cmd.fitWidth
            : mode === 'fit-page'
              ? t.cmd.fitPage
              : t.cmd.zoomActual
        )
      },
      setResolvedZoom: (percent) => {
        dispatch({ type: 'resolvedZoom', percent })
      },
      rotate: () => {
        const next = ((stateRef.current.rotation + 90) % 360) as Rotation
        dispatch({ type: 'rotation', rotation: next })
      },
      setTool: (tool) => {
        dispatch({ type: 'tool', tool })
        // Библиотека подписей живёт в панели свойств: без неё инструмент бесполезен.
        if (tool === 'sign') dispatch({ type: 'props', on: true })
      },
      setToolStyle: (tool, patch) => {
        dispatch({ type: 'toolStyle', tool, patch })
      },
      setMarkKind: (kind) => {
        dispatch({ type: 'markKind', kind })
      },
      setShapeKind: (kind) => {
        dispatch({ type: 'shapeKind', kind })
      },
      addMarkup,
      updateMarkup: (object, coalesce) => {
        const tab = activeDoc(stateRef.current)
        if (tab?.status !== 'ready') return
        const change = (markup: readonly MarkupObject[]): readonly MarkupObject[] =>
          markup.some((o) => o.id === object.id)
            ? markup.map((o) => (o.id === object.id ? object : o))
            : markup
        dispatch(
          coalesce === undefined
            ? { type: 'markup', id: tab.id, change }
            : { type: 'markup', id: tab.id, change, coalesce: `${object.id}:${coalesce}` }
        )
      },
      removeMarkup: (id) => {
        const target = id ?? selectedMarkupId(stateRef.current.selection)
        if (target !== null) removeMarkupObject(target)
      },
      select: (target) => {
        dispatch({ type: 'select', target })
      },
      setSaveMode: (mode) => {
        void updateSettings({ markup: { saveMode: mode } })
      },
      addSignature: (src) => {
        const current = stateRef.current.settings.markup.signatures
        if (current.length >= SIGNATURES_MAX) {
          toast(t.markup.signaturesFull(SIGNATURES_MAX))
          return
        }
        const id = newMarkupId()
        void updateSettings({ markup: { signatures: [...current, { id, src }] } }).then(() => {
          dispatch({ type: 'activeSignature', id })
          toast(t.markup.signatureSaved)
        })
      },
      removeSignature: (id) => {
        const current = stateRef.current.settings.markup.signatures
        void updateSettings({ markup: { signatures: current.filter((sig) => sig.id !== id) } })
        if (stateRef.current.activeSignature === id) dispatch({ type: 'activeSignature', id: null })
      },
      setActiveSignature: (id) => {
        dispatch({ type: 'activeSignature', id })
      },
      placeSignature: (page, center) => {
        const { settings, activeSignature } = stateRef.current
        const signature =
          settings.markup.signatures.find((sig) => sig.id === activeSignature) ??
          settings.markup.signatures[0]
        if (!signature) {
          toast(t.markup.signatureNone)
          return
        }
        void placeImage(signature.src, page, center, SIGNATURE_WIDTH, true)
      },
      insertImage: (file) => {
        void (async () => {
          try {
            const src = await readImageFile(file)
            const page = stateRef.current.page
            if (await placeImage(src, page, null, IMAGE_MAX_WIDTH, false)) {
              dispatch({ type: 'tool', tool: 'select' })
            }
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error))
          }
        })()
      },
      setContentMode: (mode) => {
        dispatch({ type: 'contentMode', mode })
      },
      removeSelected: () => {
        const { selection: target, selectionGroup, contentGroup } = stateRef.current
        if (contentGroup.length > 1) removeContentGroup(contentGroup)
        else if (target?.source === 'content') removeContentObject(target.page, target.object)
        else if (selectionGroup.length > 1 || target?.source === 'annotation')
          removeTargets(selectionGroup.length > 0 ? selectionGroup : target ? [target] : [])
        else if (target) removeMarkupObject(target.id)
      },
      replaceContentText: (page, line, text, style) => {
        if (text === line.text && style === undefined) return
        void editContent(text.trim().length === 0 ? 'removeLine' : 'replaceText', async (bytes) => {
          const fallbackFont = (await loadMarkupFont()).bytes
          return pdfContent.replaceText(bytes, page - 1, line, text, {
            fallbackFont,
            ...(style ? { style } : {})
          })
        })
      },
      replaceContentBlock: (page, block, text, options = {}) => {
        const unchanged =
          text === block.text &&
          options.width === undefined &&
          options.origin === undefined &&
          options.style === undefined
        if (unchanged) return
        const kind =
          text.trim().length === 0
            ? 'removeBlock'
            : options.origin !== undefined && text === block.text
              ? 'moveBlock'
              : 'replaceBlock'
        void editContent(kind, async (bytes) => {
          const fallbackFont = (await loadMarkupFont()).bytes
          return pdfContent.replaceBlock(bytes, page - 1, { lines: block.refs }, text, {
            shift: stateRef.current.contentShift,
            ...options,
            fallbackFont
          })
        })
      },
      insertContentText: (page, origin, text, style, options = {}) => {
        if (text.trim().length === 0) return
        void editContent('insertText', async (bytes) => {
          const fallbackFont = (await loadMarkupFont()).bytes
          return pdfContent.insertText(bytes, page - 1, origin, text, style, {
            ...options,
            fallbackFont
          })
        })
      },
      setContentTextStyle: (patch) => {
        dispatch({ type: 'contentTextStyle', patch })
      },
      removeContent: removeContentObject,
      replaceContentImage: (page, image, file) => {
        void (async () => {
          let data: Uint8Array
          try {
            data = await readImageBytes(file)
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error))
            return
          }
          await editContent('replaceImage', (bytes) =>
            pdfContent.replaceImage(bytes, page - 1, image, data)
          )
        })()
      },
      moveContentImage: (page, image, rect) => {
        void editContent('moveImage', (bytes) => pdfContent.moveImage(bytes, page - 1, image, rect))
      },
      moveContentGraphic: (page, graphic, rect) => {
        void editContent('moveGraphic', (bytes) =>
          pdfContent.moveGraphic(bytes, page - 1, graphic, rect)
        )
      },
      setContentShift: (shift) => {
        dispatch({ type: 'contentShift', shift })
      },
      setContentGroup: (group) => {
        dispatch({ type: 'contentGroup', group })
      },
      moveContentGroup: (group, delta) => {
        void editContent('moveGroup', async (bytes) => {
          const fallbackFont = (await loadMarkupFont()).bytes
          let next = bytes
          for (const target of group) {
            const index = target.page - 1
            const o = target.object
            const shifted = { ...o.rect, x: o.rect.x + delta.x, y: o.rect.y + delta.y }
            if (o.kind === 'block') {
              next = await pdfContent.replaceBlock(next, index, { lines: o.refs }, o.text, {
                origin: { x: o.origin.x + delta.x, y: o.origin.y + delta.y },
                shift: 'none',
                fallbackFont
              })
            } else if (o.kind === 'image') {
              next = await pdfContent.moveImage(next, index, o, shifted)
            } else if (o.kind === 'graphic') {
              next = await pdfContent.moveGraphic(next, index, o, shifted)
            }
          }
          return next
        })
      },
      eraseContent: (page, rect) => {
        void editContent('erase', (bytes) => pdfContent.eraseRegions(bytes, page - 1, [rect]))
      },
      // Формы и метаданные
      setFormValue: (name, value, coalesce) => {
        const tab = activeDoc(stateRef.current)
        if (tab?.status !== 'ready') return
        dispatch({
          type: 'forms',
          id: tab.id,
          change: (forms) =>
            sameFormValue(forms[name], value) ? forms : { ...forms, [name]: value },
          ...(coalesce === undefined ? {} : { coalesce: `form:${coalesce}` })
        })
      },
      resetForms: () => {
        const tab = activeDoc(stateRef.current)
        if (tab?.status !== 'ready' || !hasForms(tab)) return
        dispatch({ type: 'forms', id: tab.id, change: () => NO_FORMS })
        toast(t.forms.resetDone)
      },
      flattenForms: () => {
        void applyOperation(
          async (bytes) =>
            applyFormValues(bytes, NO_FORMS, {
              font: (await loadMarkupFont()).bytes,
              flatten: true
            }),
          { message: t.forms.flattened }
        )
      },
      setMetadata: (patch) =>
        applyOperation((bytes) => writeMetadata(bytes, patch), {
          keepMarkup: true,
          message: t.forms.metaSaved
        }),
      clearMetadata: () =>
        applyOperation((bytes) => clearMetadata(bytes), {
          keepMarkup: true,
          message: t.forms.metaCleared
        }),
      // Аннотации документа
      toggleSelected: (target) => {
        const { selectionGroup } = stateRef.current
        dispatch({
          type: 'selectGroup',
          targets: hasTarget(selectionGroup, target)
            ? selectionGroup.filter((item) => !sameTarget(item, target))
            : [...selectionGroup, target]
        })
      },
      selectGroup: (targets) => {
        dispatch({ type: 'selectGroup', targets })
      },
      moveSelected: (dx, dy) => {
        const { selectionGroup } = stateRef.current
        const tab = activeDoc(stateRef.current)
        const bytes = tab?.bytes
        if (tab?.status !== 'ready' || !bytes || tab.busy) return
        const ids = new Set(selectionGroup.filter((x) => x.source === 'markup').map((x) => x.id))
        const move = (markup: readonly MarkupObject[]): readonly MarkupObject[] =>
          markup.map((o) => (ids.has(o.id) && isMovable(o) ? moveObject(o, dx, dy) : o))
        if (!selectionGroup.some((x) => x.source === 'annotation')) {
          dispatch({ type: 'markup', id: tab.id, change: move })
          return
        }
        void (async () => {
          try {
            const found = await resolveAnnotations(bytes, selectionGroup)
            const edits = found
              .filter((item) => item.annotation.can.move)
              .map((item) => {
                const { rect } = item.annotation
                return { ...item, patch: { rect: { ...rect, x: rect.x + dx, y: rect.y + dy } } }
              })
            await applyOperation((current) => pdfContent.editAnnotations(current, edits), {
              keepMarkup: true,
              markup: move(activeDoc(stateRef.current)?.markup ?? tab.markup)
            })
          } catch (error) {
            toast(`${t.ops.failed}: ${error instanceof Error ? error.message : String(error)}`)
          }
        })()
      },
      editAnnotation: (page, index, patch) => {
        const bytes = activeDoc(stateRef.current)?.bytes
        if (!bytes) return
        void (async () => {
          try {
            const annotation = await findAnnotation(bytes, page, index)
            if (!annotation) return
            // Вид FreeText строится заново шрифтом с кириллицей.
            const font = annotation.subtype === 'FreeText' ? (await loadMarkupFont()).bytes : null
            await applyOperation(
              (current) =>
                pdfContent.editAnnotations(current, [{ pageIndex: page - 1, annotation, patch }], {
                  font
                }),
              { keepMarkup: true }
            )
          } catch (error) {
            toast(`${t.ops.failed}: ${error instanceof Error ? error.message : String(error)}`)
          }
        })()
      },
      togglePagesMode: (on) => {
        dispatch(on === undefined ? { type: 'pagesMode' } : { type: 'pagesMode', on })
      },
      setSidebarTab: (tab) => {
        dispatch({ type: 'sidebarTab', tab })
      },
      toggleSidebar: (on) => {
        dispatch(on === undefined ? { type: 'sidebar' } : { type: 'sidebar', on })
      },
      toggleProps: (on) => {
        dispatch(on === undefined ? { type: 'props' } : { type: 'props', on })
      },
      setPage: (page) => {
        const tab = activeDoc(stateRef.current)
        const max = Math.max(1, tab?.pages ?? 1)
        dispatch({ type: 'page', page: Math.min(max, Math.max(1, page)), scroll: true })
      },
      pageFromScroll: (page) => {
        dispatch({ type: 'page', page, scroll: false })
      },
      selectPage: (page, mode) => {
        const { selectedPages, selectionAnchor } = stateRef.current
        if (mode === 'toggle') {
          const next = new Set(selectedPages)
          if (next.has(page)) next.delete(page)
          else next.add(page)
          dispatch({ type: 'selection', pages: next, anchor: page })
        } else if (mode === 'range' && selectionAnchor !== null) {
          const [from, to] =
            selectionAnchor < page ? [selectionAnchor, page] : [page, selectionAnchor]
          dispatch({
            type: 'selection',
            pages: rangeSelect(to - from + 1, from),
            anchor: selectionAnchor
          })
        } else {
          dispatch({ type: 'selection', pages: new Set([page]), anchor: page })
        }
      },
      selectAll: () => {
        const tab = activeDoc(stateRef.current)
        if (tab) dispatch({ type: 'selection', pages: rangeSelect(tab.pages, 1), anchor: 1 })
      },
      selectNone: () => {
        dispatch({ type: 'selection', pages: new Set(), anchor: null })
      },
      search: runSearch,
      searchStep: (delta) => {
        const { search } = stateRef.current
        if (search.matches.length === 0) return
        const active = (search.active + delta + search.matches.length) % search.matches.length
        dispatch({ type: 'search', search: { ...search, active } })
        const match = search.matches[active]
        if (match) dispatch({ type: 'page', page: match.page, scroll: true })
      },
      searchGo: (index) => {
        const { search } = stateRef.current
        const match = search.matches[index]
        if (!match) return
        dispatch({ type: 'search', search: { ...search, active: index } })
        dispatch({ type: 'page', page: match.page, scroll: true })
      },
      openProperties: () => {
        dispatch({ type: 'properties', open: true })
      },
      closeProperties: () => {
        dispatch({ type: 'properties', open: false })
      },
      print: () => {
        const tab = activeDoc(stateRef.current)
        if (tab?.status !== 'ready') return
        if (tab.dirty) {
          toast(t.viewer.unsaved)
          return
        }
        api.printFile(tab.path).catch((error: unknown) => {
          toast(
            `${t.viewer.printFailed}: ${error instanceof Error ? error.message : String(error)}`
          )
        })
      },
      openExternal: (url) => {
        api.openExternal(url).catch(() => {
          toast(t.toast.linkBlocked)
        })
      },
      focusSearch: () => {
        dispatch({ type: 'sidebarTab', tab: 'search' })
        window.setTimeout(() => {
          const input = searchRef.current
          if (input) {
            input.focus()
            input.select()
          }
        }, 0)
      },

      rotateSelected: (delta) => {
        const sel = selectedOf()
        if (sel.length === 0) return
        void applyOperation((bytes) => rotatePages(bytes, sel, delta), {
          message: t.ops.rotated(sel.length),
          select: () => new Set(sel)
        })
      },
      deleteSelected: () => {
        const sel = selectedOf()
        if (sel.length === 0) return
        void applyOperation((bytes) => deletePages(bytes, sel), {
          message: t.ops.deleted(sel.length)
        })
      },
      duplicateSelected: () => {
        const sel = selectedOf()
        if (sel.length === 0) return
        void applyOperation((bytes) => duplicatePages(bytes, sel), {
          message: t.ops.duplicated(sel.length)
        })
      },
      insertBlank: () => {
        const after = insertAfter()
        void applyOperation((bytes) => insertBlankPage(bytes, after), {
          message: t.ops.blankInserted,
          select: () => new Set([after + 1])
        })
      },
      insertFromFile: () => {
        void (async () => {
          const file = await api.openPdfDialog()
          if (!file) return
          const source = new Uint8Array((await api.readFile(file.path)).bytes)
          const after = insertAfter()
          const before = activeDoc(stateRef.current)?.pages ?? 0
          await applyOperation((bytes) => insertPagesFrom(bytes, source, after), {
            select: (): ReadonlySet<number> => {
              const now = activeDoc(stateRef.current)?.pages ?? before
              return rangeSelect(Math.max(0, now - before), after + 1)
            }
          })
          const added = (activeDoc(stateRef.current)?.pages ?? before) - before
          if (added > 0) toast(t.ops.inserted(added))
        })()
      },
      extractSelected: () => {
        const tab = activeDoc(stateRef.current)
        const sel = selectedOf()
        if (!tab?.bytes || sel.length === 0) return
        void (async () => {
          try {
            const bytes = await extractPages(await bakeMarkup(tab), sel)
            const defaultName = safeFileName(
              t.pages.extractName(
                stripExtension(tab.name),
                formatPageList(sel).replace(/,\s*/g, '_')
              )
            )
            const path = await api.savePdfDialog({
              title: t.ops.extractTitle,
              defaultPath: joinPath(dirnameOf(tab.path), defaultName)
            })
            if (path === null) return
            await api.writeFile({ path, bytes: toArrayBuffer(bytes), backup: false })
            toast(t.ops.extracted(basenameOf(path)))
            openPath(path)
          } catch (error) {
            toast(`${t.ops.failed}: ${error instanceof Error ? error.message : String(error)}`)
          }
        })()
      },
      movePages: (target) => {
        const tab = activeDoc(stateRef.current)
        const sel = selectedOf()
        if (!tab || sel.length === 0) return
        const order = computeMoveOrder(tab.pages, sel, target)
        if (isIdentityOrder(order)) return
        const moved = new Set(sel)
        const selected = new Set<number>()
        order.forEach((p, i) => {
          if (moved.has(p)) selected.add(i + 1)
        })
        void applyOperation((bytes) => reorderPages(bytes, order), {
          message: t.ops.moved,
          select: () => selected
        })
      },
      undo: () => {
        void restoreSnapshot('undo')
      },
      redo: () => {
        void restoreSnapshot('redo')
      },
      save,
      saveAs,
      // Сравнение
      compareWith: () => {
        const tab = activeDoc(stateRef.current)
        if (tab?.status !== 'ready' || !tab.doc) {
          toast(t.compare.needDoc)
          return
        }
        // Запрос пароля второго файла показывает экран документа.
        if (stateRef.current.screen !== 'viewer') dispatch({ type: 'activateDoc', id: tab.id })
        void (async () => {
          const file = await api.openPdfDialog()
          if (!file) return
          const askPassword = (reason: PasswordReason): Promise<string | null> =>
            new Promise((resolve) => {
              dispatch({
                type: 'password',
                request: {
                  fileName: file.name,
                  reason,
                  resolve: (password) => {
                    dispatch({ type: 'password', request: null })
                    resolve(password)
                  }
                }
              })
            })
          try {
            const bytes = new Uint8Array((await api.readFile(file.path)).bytes)
            const doc = await loadPdfDocument(bytes, { askPassword })
            if (!stateRef.current.docs.some((d) => d.id === tab.id)) {
              doc.destroy()
              return
            }
            compareCounter += 1
            dispatch({
              type: 'compareOpen',
              session: { id: compareCounter, baseId: tab.id, doc, name: file.name, path: file.path }
            })
            console.info(`[pdfwright] сравнение: ${tab.name} и ${file.name}`)
          } catch (error) {
            if (error instanceof PdfLoadError && error.kind === 'cancelled') return
            toast(
              `${t.compare.openFailed}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        })()
      },
      closeCompare: () => {
        const session = stateRef.current.compare
        if (!session) return
        dispatch({ type: 'compareClose' })
        // Документ освобождается после того, как экран сравнения размонтирован.
        window.setTimeout(() => {
          session.doc.destroy()
        }, 0)
      },
      // Распознавание текста
      applyTextLayer: (run, message) => applyOperation(run, { keepMarkup: true, message }),
      openTool: (dialog) => {
        dispatch({ type: 'toolDialog', dialog })
      },
      // Конвертация
      convertSource: async () => {
        const tab = activeDoc(stateRef.current)
        if (tab?.status !== 'ready' || !tab.bytes) return null
        return { name: tab.name, path: tab.path, pages: tab.pages, bytes: await bakeMarkup(tab) }
      },
      openNewDocument: async (name, bytes) => {
        docCounter += 1
        const id = `doc-${docCounter}`
        dispatch({
          type: 'docOpen',
          doc: {
            id,
            name,
            path: '',
            status: 'loading',
            doc: null,
            pages: 0,
            fileSize: 0,
            error: null,
            sizesVersion: 0,
            bytes: null,
            dirty: true,
            markup: [],
            forms: NO_FORMS,
            history: [],
            future: [],
            coalesce: null,
            busy: false
          }
        })
        try {
          const doc = await loadPdfDocument(bytes, { askPassword: () => Promise.resolve(null) })
          if (!stateRef.current.docs.some((d) => d.id === id)) {
            doc.destroy()
            return false
          }
          dispatch({ type: 'docReady', id, doc, bytes, fileSize: bytes.length })
          void doc.loadSizes(() => {
            dispatch({ type: 'docSizes', id })
          })
          return true
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          dispatch({ type: 'docError', id, error: message })
          return false
        }
      },
      replaceDocument: (bytes, message) =>
        applyOperation(() => Promise.resolve(bytes), { message }),
      // Защита паролем
      setProtection: (options) => {
        const tab = activeDoc(stateRef.current)
        if (tab?.status !== 'ready' || tab.busy) return
        dispatch({ type: 'protection', id: tab.id, protection: { kind: 'new', options } })
        toast(t.protect.applied)
      },
      removeProtection: () => {
        const tab = activeDoc(stateRef.current)
        if (tab?.status !== 'ready' || tab.busy || !tab.protection) return
        dispatch({ type: 'protection', id: tab.id, protection: null })
        toast(t.protect.removed)
      },
      checkUpdates: () => {
        dispatch({
          type: 'update',
          patch: { phase: 'checking', message: null, info: null, percent: 0 }
        })
        api
          .checkForUpdates()
          .then((result) => {
            if (result.status === 'none') {
              dispatch({
                type: 'update',
                patch: { phase: 'none', message: t.settings.updatesNone(result.current) }
              })
            } else {
              dispatch({
                type: 'update',
                patch: {
                  phase: 'available',
                  info: result.info,
                  canInstall: result.canInstall,
                  message: null
                }
              })
            }
          })
          .catch((error: unknown) => {
            dispatch({
              type: 'update',
              patch: { phase: 'error', message: describeUpdateError(error) }
            })
          })
      },
      downloadUpdate: () => {
        dispatch({ type: 'update', patch: { phase: 'downloading', percent: 0, message: null } })
        api
          .downloadUpdate()
          .then(() => {
            dispatch({
              type: 'update',
              patch: { phase: 'downloaded', percent: 100, confirmInstall: true }
            })
          })
          .catch((error: unknown) => {
            const message = describeUpdateError(error)
            dispatch({
              type: 'update',
              patch: {
                phase: message === t.settings.updatesCancelled ? 'available' : 'error',
                message,
                percent: 0
              }
            })
          })
      },
      cancelUpdate: () => {
        api.cancelUpdateDownload().catch(() => undefined)
      },
      installUpdate: (confirmed) => {
        if (!confirmed) {
          dispatch({
            type: 'update',
            patch: { confirmInstall: false, message: t.settings.updatesDeferred }
          })
          return
        }
        if (stateRef.current.docs.some((d) => d.dirty)) {
          dispatch({
            type: 'update',
            patch: { confirmInstall: false, message: t.settings.updatesInstallDirty }
          })
          return
        }
        dispatch({ type: 'update', patch: { confirmInstall: false } })
        api.installUpdate().catch((error: unknown) => {
          dispatch({
            type: 'update',
            patch: { phase: 'error', message: describeUpdateError(error) }
          })
        })
      }
    }
  }, [
    addMarkup,
    api,
    applyOperation,
    bakeMarkup,
    editContent,
    openDialog,
    openPath,
    placeImage,
    restoreSnapshot,
    runSearch,
    save,
    saveAs,
    toast,
    updateSettings,
    writeTab
  ])

  // Сравнение: вторая версия освобождается, когда пользователь ушёл с экрана
  // сравнения (вкладка, «Начало») или закрыл сравниваемый документ.
  const compareSession = state.compare
  const compareLeft =
    compareSession !== null &&
    (state.screen !== 'compare' || !state.docs.some((d) => d.id === compareSession.baseId))
  useEffect(() => {
    if (compareLeft) actions.closeCompare()
  }, [compareLeft, actions])

  // Команды меню приложения приходят из main и выполняются теми же действиями.
  useEffect(() => {
    const run = (command: AppCommand): void => {
      switch (command) {
        case 'file.open':
          void actions.openDialog()
          break
        case 'file.save':
          void actions.save()
          break
        case 'file.saveAs':
          void actions.saveAs()
          break
        case 'file.print':
          actions.print()
          break
        case 'file.close':
          actions.requestCloseDoc()
          break
        case 'file.properties':
          actions.openProperties()
          break
        case 'file.protect': {
          const tab = activeDoc(stateRef.current)
          if (tab?.status !== 'ready') {
            actions.toast(t.protect.needDoc)
            break
          }
          actions.activateDoc(tab.id)
          actions.openTool('protect')
          break
        }
        case 'edit.undo':
          actions.undo()
          break
        case 'edit.redo':
          actions.redo()
          break
        case 'edit.find':
          actions.focusSearch()
          break
        case 'tools.toImages':
          actions.openTool('toImages')
          break
        case 'tools.fromImages':
          actions.openTool('fromImages')
          break
        case 'tools.extractText':
          actions.openTool('extractText')
          break
        case 'tools.ocr':
          actions.openTool('ocr')
          break
        case 'tools.compress':
          actions.openTool('compress')
          break
        case 'tools.merge':
          actions.openTool('merge')
          break
        case 'tools.split':
          actions.openTool('split')
          break
        case 'tools.compare':
          actions.compareWith()
          break
        case 'app.settings':
          actions.openSettings()
          break
        case 'app.start':
          actions.go('start')
          break
        case 'view.zoomIn':
          actions.zoomBy(1)
          break
        case 'view.zoomOut':
          actions.zoomBy(-1)
          break
        case 'view.zoomReset':
          actions.zoomTo(100)
          break
        case 'view.fitWidth':
          actions.setZoomMode('fit-width')
          break
        case 'view.fitPage':
          actions.setZoomMode('fit-page')
          break
        case 'view.rotate':
          actions.rotate()
          break
        case 'view.pages':
          actions.togglePagesMode()
          break
        case 'view.sidebar':
          actions.toggleSidebar()
          break
        case 'view.props':
          actions.toggleProps()
          break
        case 'view.theme':
          actions.cycleTheme()
          break
        case 'help.releases':
          actions.openExternal(RELEASES_PAGE)
          break
        case 'help.about':
          actions.openSettings('about')
          break
      }
    }
    return api.onCommand(run)
  }, [api, actions])

  const value = useMemo<Store>(() => ({ state, actions, api, searchRef }), [state, actions, api])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore вне StoreProvider')
  return store
}
