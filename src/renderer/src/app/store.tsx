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
import type { AppCommand, AppInfo, PdfwrightApi, RecentFile } from '@shared/ipc-contract'
import { RELEASES_PAGE } from '@shared/external-links'
import {
  createDefaultSettings,
  type AppSettings,
  type SettingsPatch,
  type Theme,
  type ZoomMode as DefaultZoomMode
} from '@shared/settings-schema'
import {
  loadPdfDocument,
  PdfLoadError,
  type PasswordReason,
  type PdfDocument,
  type Rotation
} from '@renderer/pdf-engine/engine'
import { findMatches, type TextMatch } from '@shared/pdf-search'
import { t } from '@renderer/i18n'
import { getApi } from './api'
import { applyTheme, resolvedTheme } from './theme'

export type Screen = 'start' | 'viewer' | 'settings' | 'kit'
export type Tool = 'select' | 'hand' | 'marker' | 'pen' | 'shapes' | 'text' | 'sign'
export type SidebarTab = 'thumbs' | 'outline' | 'search'
export type SettingsSection = 'general' | 'view' | 'updates' | 'about' | 'author'
export type ZoomMode = 'fit-width' | 'fit-page' | 'custom'

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
}

export interface ZoomState {
  mode: ZoomMode
  /** Проценты для режима custom; в fit-режимах фактическое значение считает DocumentView. */
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

export interface PasswordRequest {
  fileName: string
  reason: PasswordReason
  resolve: (password: string | null) => void
}

export const ZOOM_STEPS = [25, 33, 50, 67, 80, 90, 100, 110, 125, 150, 175, 200, 300, 400] as const
export const TOOLS: readonly Tool[] = ['select', 'hand', 'marker', 'pen', 'shapes', 'text', 'sign']
export const TOOL_KEYS: Record<Tool, string> = {
  select: 'V',
  hand: 'H',
  marker: 'M',
  pen: 'P',
  shapes: 'U',
  text: 'T',
  sign: 'S'
}
export const MARK_COLORS = ['#ffd86b', '#9be39b', '#9fd3ff', '#ffb0c8', '#d7bfff'] as const

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
  markColor: string
  pagesMode: boolean
  page: number
  scrollRequest: { page: number; token: number } | null
  selectedPages: ReadonlySet<number>
  search: SearchState
  passwordRequest: PasswordRequest | null
  propertiesOpen: boolean
  settingsSection: SettingsSection
}

type Action =
  | { type: 'ready'; info: AppInfo; settings: AppSettings; recent: RecentFile[] }
  | { type: 'settings'; settings: AppSettings }
  | { type: 'recent'; recent: RecentFile[] }
  | { type: 'screen'; screen: Screen }
  | { type: 'settingsSection'; section: SettingsSection }
  | { type: 'docOpen'; doc: DocTab }
  | { type: 'docReady'; id: string; doc: PdfDocument; pages: number; fileSize: number }
  | { type: 'docError'; id: string; error: string }
  | { type: 'docSizes'; id: string }
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
  | { type: 'markColor'; color: string }
  | { type: 'pagesMode'; on?: boolean }
  | { type: 'page'; page: number; scroll: boolean }
  | { type: 'togglePage'; page: number }
  | { type: 'search'; search: SearchState }
  | { type: 'password'; request: PasswordRequest | null }
  | { type: 'properties'; open: boolean }

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
  markColor: MARK_COLORS[0],
  pagesMode: false,
  page: 1,
  scrollRequest: null,
  selectedPages: new Set(),
  search: EMPTY_SEARCH,
  passwordRequest: null,
  propertiesOpen: false,
  settingsSection: 'general'
}

let scrollToken = 0

function resetView(state: State): State {
  return {
    ...state,
    page: 1,
    scrollRequest: null,
    selectedPages: new Set(),
    search: EMPTY_SEARCH,
    rotation: 0,
    pagesMode: false,
    zoom: zoomFromSetting(state.settings.viewer.defaultZoom)
  }
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
      return {
        ...state,
        docs: state.docs.map((d) =>
          d.id === action.id
            ? {
                ...d,
                status: 'ready',
                doc: action.doc,
                pages: action.pages,
                fileSize: action.fileSize,
                error: null
              }
            : d
        )
      }
    case 'docError':
      return {
        ...state,
        docs: state.docs.map((d) =>
          d.id === action.id ? { ...d, status: 'error', error: action.error } : d
        )
      }
    case 'docSizes':
      return {
        ...state,
        docs: state.docs.map((d) =>
          d.id === action.id ? { ...d, sizesVersion: d.sizesVersion + 1 } : d
        )
      }
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
      return { ...state, tool: action.tool }
    case 'markColor':
      return { ...state, markColor: action.color }
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
    case 'togglePage': {
      const selectedPages = new Set(state.selectedPages)
      if (selectedPages.has(action.page)) selectedPages.delete(action.page)
      else selectedPages.add(action.page)
      return { ...state, selectedPages }
    }
    case 'search':
      return { ...state, search: action.search }
    case 'password':
      return { ...state, passwordRequest: action.request }
    case 'properties':
      return { ...state, propertiesOpen: action.open }
  }
}

export interface Actions {
  go: (screen: Screen) => void
  openSettings: (section?: SettingsSection) => void
  openDialog: () => Promise<void>
  openPath: (path: string) => void
  openFiles: (files: FileList | File[]) => void
  closeDoc: (id?: string) => void
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
  setMarkColor: (color: string) => void
  togglePagesMode: (on?: boolean) => void
  setSidebarTab: (tab: SidebarTab) => void
  toggleSidebar: (on?: boolean) => void
  toggleProps: (on?: boolean) => void
  setPage: (page: number) => void
  pageFromScroll: (page: number) => void
  togglePage: (page: number) => void
  search: (query: string) => void
  searchStep: (delta: 1 | -1) => void
  searchGo: (index: number) => void
  openProperties: () => void
  closeProperties: () => void
  print: () => void
  openExternal: (url: string) => void
  focusSearch: () => void
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

let docCounter = 0

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
    }, 2200)
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
      const name = path.split(/[\\/]/).pop() ?? path
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
          sizesVersion: 0
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
          const doc = await loadPdfDocument(file.bytes, { askPassword })
          if (!stateRef.current.docs.some((d) => d.id === id)) {
            doc.destroy()
            return
          }
          dispatch({ type: 'docReady', id, doc, pages: doc.numPages, fileSize: file.size })
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
    return api.onOpenFile(openPath)
  }, [api, openPath])

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

  const actions = useMemo<Actions>(
    () => ({
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
      closeDoc: (id) => {
        const target = id ?? stateRef.current.activeId
        if (target !== null) dispatch({ type: 'closeDoc', id: target })
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
      },
      setMarkColor: (color) => {
        dispatch({ type: 'markColor', color })
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
      togglePage: (page) => {
        dispatch({ type: 'togglePage', page })
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
      }
    }),
    [api, openDialog, openPath, runSearch, toast, updateSettings]
  )

  // Команды меню приложения приходят из main и выполняются теми же действиями.
  useEffect(() => {
    const run = (command: AppCommand): void => {
      switch (command) {
        case 'file.open':
          void actions.openDialog()
          break
        case 'file.save':
        case 'file.saveAs':
          actions.toast(t.toast.soon)
          break
        case 'file.print':
          actions.print()
          break
        case 'file.close':
          actions.closeDoc()
          break
        case 'file.properties':
          actions.openProperties()
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
        case 'view.sidebar':
          actions.toggleSidebar()
          break
        case 'view.props':
          actions.toggleProps()
          break
        case 'view.theme':
          actions.cycleTheme()
          break
        case 'edit.find':
          actions.focusSearch()
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
