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
  type MarkupSaveMode,
  type SettingsPatch,
  type Theme,
  type ZoomMode as DefaultZoomMode
} from '@shared/settings-schema'
import {
  applyMarkup,
  computeMoveOrder,
  deletePages,
  duplicatePages,
  extractPages,
  formatPageList,
  insertBlankPage,
  insertPagesFrom,
  isIdentityOrder,
  reorderPages,
  rotatePages
} from '@shared/pdf-ops'
import { findMatches, type TextMatch } from '@shared/pdf-search'
import { pushSnapshot, type Snapshot } from '@shared/markup/history'
import { boxRectCentered, normalizeTurn, type Point } from '@shared/markup/geometry'
import {
  newMarkupId,
  type MarkupObject,
  type ShapeKind,
  type TextMarkKind
} from '@shared/markup/model'
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
  sameTarget,
  selectedMarkupId,
  type PageContentObject,
  type SelectionTarget
} from '@renderer/features/markup/selection'
import { pdfContent } from '@renderer/pdf-content/client'
import { getApi } from './api'
import { applyTheme, resolvedTheme } from './theme'

export type Screen = 'start' | 'viewer' | 'settings' | 'kit'
export type Tool = 'select' | 'edit' | 'hand' | 'marker' | 'pen' | 'shapes' | 'text' | 'sign'
/** Инструмент «Правка»: выбор объектов документа, новый текст или ластик области. */
export type ContentMode = 'objects' | 'text' | 'erase'
type ContentEditKind = keyof typeof t.content.done
export type SidebarTab = 'thumbs' | 'outline' | 'search'
export type SettingsSection = 'general' | 'view' | 'updates' | 'about' | 'author'
export type ZoomMode = 'fit-width' | 'fit-page' | 'custom'
export type ToolDialog = 'merge' | 'split' | null
export type SelectMode = 'single' | 'toggle' | 'range'
/** Инструменты со своим цветом, непрозрачностью и толщиной в панели свойств. */
export type StyledTool = 'marker' | 'pen' | 'shapes' | 'text'

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
export type TabSnapshot = Snapshot<Uint8Array, readonly MarkupObject[]>

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
  history: TabSnapshot[]
  future: TabSnapshot[]
  /** Ключ последней правки: подряд идущие правки с тем же ключом (ползунок) — один шаг отмены. */
  coalesce: string | null
  busy: boolean
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

export const ZOOM_STEPS = [25, 33, 50, 67, 80, 90, 100, 110, 125, 150, 175, 200, 300, 400] as const
export const TOOLS: readonly Tool[] = [
  'select',
  'edit',
  'hand',
  'marker',
  'pen',
  'shapes',
  'text',
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
  /** Стиль нового текста в «Правке»: берётся у последнего выбранного текста документа. */
  contentTextStyle: TextStyle | null
  selection: SelectionTarget | null
  pagesMode: boolean
  page: number
  scrollRequest: { page: number; token: number } | null
  selectedPages: ReadonlySet<number>
  selectionAnchor: number | null
  search: SearchState
  passwordRequest: PasswordRequest | null
  propertiesOpen: boolean
  closeConfirm: string | null
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
  | { type: 'docReady'; id: string; doc: PdfDocument; bytes: Uint8Array; fileSize: number }
  | { type: 'docError'; id: string; error: string }
  | { type: 'docSizes'; id: string }
  | { type: 'docBusy'; id: string; busy: boolean }
  | {
      type: 'docReplace'
      id: string
      doc: PdfDocument
      bytes: Uint8Array
      markup: readonly MarkupObject[]
      history: TabSnapshot[]
      future: TabSnapshot[]
      dirty: boolean
      selectedPages: ReadonlySet<number>
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
      history: TabSnapshot[]
      future: TabSnapshot[]
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
  | { type: 'select'; target: SelectionTarget | null }
  | { type: 'pagesMode'; on?: boolean }
  | { type: 'page'; page: number; scroll: boolean }
  | { type: 'selection'; pages: ReadonlySet<number>; anchor: number | null }
  | { type: 'search'; search: SearchState }
  | { type: 'password'; request: PasswordRequest | null }
  | { type: 'properties'; open: boolean }
  | { type: 'closeConfirm'; id: string | null }
  | { type: 'toolDialog'; dialog: ToolDialog }
  | { type: 'update'; patch: Partial<UpdateState> }

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
    text: { color: INK_COLORS[0], opacity: 1, width: 1, fontSize: 14 }
  },
  markKind: 'highlight',
  shapeKind: 'rect',
  activeSignature: null,
  contentMode: 'objects',
  contentTextStyle: null,
  selection: null,
  pagesMode: false,
  page: 1,
  scrollRequest: null,
  selectedPages: new Set(),
  selectionAnchor: null,
  search: EMPTY_SEARCH,
  passwordRequest: null,
  propertiesOpen: false,
  closeConfirm: null,
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
  if (target?.source === 'content') return target
  return target && markup.some((o) => o.id === target.id) ? target : null
}

function textStyleOf(object: PageContentObject): TextStyle | null {
  if (object.kind === 'block') return object.style
  if (object.kind !== 'text') return null
  const { fontName, fontSize, color, bold, italic } = object
  return { fontName, fontSize, color, bold, italic }
}

/** Какой выбор имеет смысл в инструменте: разметка — в «Выделении», документ — в «Правке». */
function selectionForTool(target: SelectionTarget | null, tool: Tool): SelectionTarget | null {
  if (target?.source === 'markup' && tool === 'select') return target
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
        error: null
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
        history: action.history,
        future: action.future,
        coalesce: null,
        dirty: action.dirty,
        busy: false,
        sizesVersion: d.sizesVersion + 1
      }))
      const page = Math.min(state.page, action.doc.numPages)
      return {
        ...next,
        page,
        selectedPages: action.selectedPages,
        selectionAnchor: null,
        // Строки и картинки документа после новых байтов читаются заново.
        selection:
          state.selection?.source === 'content'
            ? null
            : keepSelection(state.selection, action.markup),
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
        history: merge ? d.history : pushSnapshot(d.history, { bytes, markup: d.markup }),
        future: merge ? d.future : [],
        coalesce: action.coalesce ?? null,
        dirty: true
      }))
      const target = action.select === undefined ? state.selection : action.select
      return { ...next, selection: keepSelection(target, markup) }
    }
    case 'markupRestore': {
      const next = updateDoc(state, action.id, (d) => ({
        ...d,
        markup: action.markup,
        history: action.history,
        future: action.future,
        coalesce: null,
        dirty: true
      }))
      return { ...next, selection: keepSelection(state.selection, action.markup) }
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
        selection: selectionForTool(state.selection, action.tool)
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
        selection: action.mode === 'objects' ? state.selection : null
      }
    case 'contentTextStyle':
      return state.contentTextStyle
        ? { ...state, contentTextStyle: { ...state.contentTextStyle, ...action.patch } }
        : state
    case 'select': {
      if (sameTarget(state.selection, action.target)) return state
      // Выбранный текст документа задаёт стиль нового текста в «Правке».
      const style = action.target?.source === 'content' ? textStyleOf(action.target.object) : null
      return {
        ...state,
        selection: action.target,
        contentTextStyle: style ?? state.contentTextStyle
      }
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
    case 'toolDialog':
      return { ...state, toolDialog: action.dialog }
    case 'update':
      return { ...state, update: { ...state.update, ...action.patch } }
  }
}

export interface Actions {
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
  replaceContentImage: (page: number, image: PageImage, file: File) => void
  moveContentImage: (page: number, image: PageImage, rect: PdfSpaceRect) => void
  eraseContent: (page: number, rect: PdfSpaceRect) => void
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
  openTool: (dialog: ToolDialog) => void
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
    (path: string) => {
      const existing = stateRef.current.docs.find((d) => d.path === path)
      if (existing && existing.status !== 'error') {
        dispatch({ type: 'activateDoc', id: existing.id })
        return
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
          history: [],
          future: [],
          coalesce: null,
          busy: false
        }
      })
      const askPassword = (reason: PasswordReason): Promise<string | null> =>
        new Promise((resolve) => {
          dispatch({
            type: 'password',
            request: {
              fileName: name,
              reason,
              resolve: (password) => {
                dispatch({ type: 'password', request: null })
                resolve(password)
              }
            }
          })
        })
      void (async () => {
        try {
          const file = await api.readFile(path)
          const bytes = new Uint8Array(file.bytes)
          const doc = await loadPdfDocument(bytes, { askPassword })
          if (!stateRef.current.docs.some((d) => d.id === id)) {
            doc.destroy()
            return
          }
          dispatch({ type: 'docReady', id, doc, bytes, fileSize: file.size })
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
      void api.takePendingOpenFile().then((path) => {
        if (path !== null) openPath(path)
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
  }, [api, openPath])

  // main спрашивает подтверждение при закрытии окна, если есть несохранённые документы.
  const dirtyCount = state.docs.filter((d) => d.dirty).length
  useEffect(() => {
    api.setDirtyCount(dirtyCount).catch(() => undefined)
  }, [api, dirtyCount])

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

  /** Байты документа с записанной в них несохранённой разметкой (режим из настроек). */
  const bakeMarkup = useCallback(async (tab: DocTab): Promise<Uint8Array> => {
    const bytes = tab.bytes ?? new Uint8Array()
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
      } = {}
    ): Promise<boolean> => {
      const tab = activeDoc(stateRef.current)
      if (tab?.status !== 'ready' || !tab.bytes || tab.busy) return false
      dispatch({ type: 'docBusy', id: tab.id, busy: true })
      try {
        const bytes = await run(options.keepMarkup ? tab.bytes : await bakeMarkup(tab))
        const doc = await loadPdfDocument(bytes, { askPassword: () => Promise.resolve(null) })
        const previous = tab.doc
        const history = pushSnapshot(tab.history, { bytes: tab.bytes, markup: tab.markup })
        dispatch({
          type: 'docReplace',
          id: tab.id,
          doc,
          bytes,
          markup: options.keepMarkup ? tab.markup : [],
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
      const current: TabSnapshot = { bytes: tab.bytes, markup: tab.markup }
      const history = direction === 'undo' ? tab.history.slice(0, -1) : [...tab.history, current]
      const future = direction === 'undo' ? [...tab.future, current] : tab.future.slice(0, -1)
      // Шаг разметки: байты те же, документ не перезагружаем.
      if (snapshot.bytes === tab.bytes) {
        dispatch({ type: 'markupRestore', id: tab.id, markup: snapshot.markup, history, future })
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
          history,
          future,
          dirty: true,
          selectedPages: new Set()
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
        if (tab.markup.length > 0) {
          // Разметка записывается в документ отдельным шагом истории: Ctrl+Z
          // после сохранения возвращает её в редактируемые объекты.
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
              history: pushSnapshot(tab.history, { bytes: tab.bytes, markup: tab.markup }),
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
        await api.writeFile({
          path,
          bytes: toArrayBuffer(bytes),
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
    return writeTab(tab, tab.path)
  }, [writeTab])

  const saveAs = useCallback(async (): Promise<boolean> => {
    const tab = activeDoc(stateRef.current)
    if (tab?.status !== 'ready' || tab.busy) return false
    const path = await api.savePdfDialog({ title: t.ops.saveAsTitle, defaultPath: tab.path })
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
      addMarkup({
        id: newMarkupId(),
        page,
        kind: 'image',
        color: '#000000',
        opacity: 1,
        rect: boxRectCentered(at, width, height, rotate),
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
    const removeContentObject = (page: number, object: PageContentObject): void => {
      const index = page - 1
      switch (object.kind) {
        case 'text':
          void editContent('removeLine', (bytes) => pdfContent.removeTextLine(bytes, index, object))
          break
        case 'block':
          void editContent('removeBlock', (bytes) =>
            pdfContent.replaceBlock(bytes, index, { lines: object.refs }, '')
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

    return {
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
        const target = stateRef.current.selection
        if (target?.source === 'content') removeContentObject(target.page, target.object)
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
      eraseContent: (page, rect) => {
        void editContent('erase', (bytes) => pdfContent.eraseRegions(bytes, page - 1, [rect]))
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
              `${stripExtension(tab.name)}_стр${formatPageList(sel).replace(/,\s*/g, '_')}.pdf`
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
      openTool: (dialog) => {
        dispatch({ type: 'toolDialog', dialog })
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
    updateSettings
  ])

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
        case 'edit.undo':
          actions.undo()
          break
        case 'edit.redo':
          actions.redo()
          break
        case 'edit.find':
          actions.focusSearch()
          break
        case 'tools.merge':
          actions.openTool('merge')
          break
        case 'tools.split':
          actions.openTool('split')
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
