/* eslint-disable react-refresh/only-export-components -- модуль состояния, не компонент */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode
} from 'react'
import type { AppCommand, AppInfo, PdfwrightApi } from '@shared/ipc-contract'
import { RELEASES_PAGE } from '@shared/external-links'
import {
  createDefaultSettings,
  type AppSettings,
  type SettingsPatch,
  type Theme
} from '@shared/settings-schema'
import { getApi } from './api'
import { applyTheme, resolvedTheme } from './theme'
import { t } from '@renderer/i18n'

export type Screen = 'start' | 'viewer' | 'settings' | 'kit'
export type Tool = 'select' | 'hand' | 'marker' | 'pen' | 'shapes' | 'text' | 'sign'
export type SidebarTab = 'thumbs' | 'outline' | 'search'
export type SettingsSection = 'general' | 'view' | 'updates' | 'about' | 'author'

export interface DocTab {
  id: string
  name: string
  path: string
  /** До фазы 2 число страниц условное. */
  pages: number
}

export const ZOOM_STEPS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200] as const
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
  recent: DocTab[]
  toast: string | null
  sidebar: boolean
  props: boolean
  sidebarTab: SidebarTab
  zoom: number
  tool: Tool
  markColor: string
  pagesMode: boolean
  page: number
  selectedPages: ReadonlySet<number>
  settingsSection: SettingsSection
}

type Action =
  | { type: 'ready'; info: AppInfo; settings: AppSettings }
  | { type: 'settings'; settings: AppSettings }
  | { type: 'screen'; screen: Screen }
  | { type: 'settingsSection'; section: SettingsSection }
  | { type: 'openDoc'; doc: DocTab }
  | { type: 'closeDoc'; id: string }
  | { type: 'activateDoc'; id: string }
  | { type: 'toast'; message: string | null }
  | { type: 'sidebar'; on?: boolean }
  | { type: 'props'; on?: boolean }
  | { type: 'sidebarTab'; tab: SidebarTab }
  | { type: 'zoom'; zoom: number }
  | { type: 'tool'; tool: Tool }
  | { type: 'markColor'; color: string }
  | { type: 'pagesMode'; on?: boolean }
  | { type: 'page'; page: number }
  | { type: 'togglePage'; page: number }

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
  zoom: 100,
  tool: 'select',
  markColor: MARK_COLORS[0],
  pagesMode: false,
  page: 1,
  selectedPages: new Set(),
  settingsSection: 'general'
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ready':
      return { ...state, ready: true, info: action.info, settings: action.settings }
    case 'settings':
      return { ...state, settings: action.settings }
    case 'screen':
      return { ...state, screen: action.screen }
    case 'settingsSection':
      return { ...state, settingsSection: action.section, screen: 'settings' }
    case 'openDoc': {
      const existing = state.docs.find((d) => d.path === action.doc.path)
      const docs = existing ? state.docs : [...state.docs, action.doc]
      const recent = [action.doc, ...state.recent.filter((d) => d.path !== action.doc.path)].slice(
        0,
        state.settings.files.recentLimit
      )
      return {
        ...state,
        docs,
        recent,
        activeId: existing?.id ?? action.doc.id,
        screen: 'viewer',
        pagesMode: false,
        page: 1,
        selectedPages: new Set()
      }
    }
    case 'closeDoc': {
      const index = state.docs.findIndex((d) => d.id === action.id)
      const docs = state.docs.filter((d) => d.id !== action.id)
      let activeId = state.activeId
      if (activeId === action.id) activeId = (docs[index] ?? docs[index - 1])?.id ?? null
      return {
        ...state,
        docs,
        activeId,
        screen: activeId === null && state.screen === 'viewer' ? 'start' : state.screen
      }
    }
    case 'activateDoc':
      return { ...state, activeId: action.id, screen: 'viewer' }
    case 'toast':
      return { ...state, toast: action.message }
    case 'sidebar':
      return { ...state, sidebar: action.on ?? !state.sidebar }
    case 'props':
      return { ...state, props: action.on ?? !state.props }
    case 'sidebarTab':
      return { ...state, sidebarTab: action.tab, sidebar: true }
    case 'zoom':
      return { ...state, zoom: action.zoom }
    case 'tool':
      return { ...state, tool: action.tool }
    case 'markColor':
      return { ...state, markColor: action.color }
    case 'pagesMode':
      return { ...state, pagesMode: action.on ?? !state.pagesMode }
    case 'page':
      return { ...state, page: action.page }
    case 'togglePage': {
      const selectedPages = new Set(state.selectedPages)
      if (selectedPages.has(action.page)) selectedPages.delete(action.page)
      else selectedPages.add(action.page)
      return { ...state, selectedPages }
    }
  }
}

export interface Actions {
  go: (screen: Screen) => void
  openSettings: (section?: SettingsSection) => void
  openDialog: () => Promise<void>
  openDoc: (doc: DocTab) => void
  closeDoc: (id?: string) => void
  activateDoc: (id: string) => void
  updateSettings: (patch: SettingsPatch) => Promise<void>
  cycleTheme: () => void
  toast: (message: string) => void
  zoomBy: (delta: 1 | -1) => void
  zoomTo: (zoom: number) => void
  setTool: (tool: Tool) => void
  setMarkColor: (color: string) => void
  togglePagesMode: (on?: boolean) => void
  setSidebarTab: (tab: SidebarTab) => void
  toggleSidebar: (on?: boolean) => void
  toggleProps: (on?: boolean) => void
  setPage: (page: number) => void
  togglePage: (page: number) => void
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
  const searchRef = useRef<HTMLInputElement | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    void Promise.all([api.getAppInfo(), api.getSettings()]).then(([info, settings]) => {
      applyTheme(settings.general.theme)
      dispatch({ type: 'ready', info, settings })
    })
  }, [api])

  const toast = useCallback((message: string) => {
    dispatch({ type: 'toast', message })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => {
      dispatch({ type: 'toast', message: null })
    }, 1800)
  }, [])

  const updateSettings = useCallback(
    async (patch: SettingsPatch) => {
      const settings = await api.updateSettings(patch)
      applyTheme(settings.general.theme)
      dispatch({ type: 'settings', settings })
    },
    [api]
  )

  const openDoc = useCallback((doc: DocTab) => {
    dispatch({ type: 'openDoc', doc })
  }, [])

  const openDialog = useCallback(async () => {
    const file = await api.openPdfDialog()
    if (!file) return
    docCounter += 1
    openDoc({ id: `doc-${docCounter}`, name: file.name, path: file.path, pages: 14 })
  }, [api, openDoc])

  const actions = useMemo<Actions>(
    () => ({
      go: (screen) => {
        dispatch({ type: 'screen', screen })
      },
      openSettings: (section = 'general') => {
        dispatch({ type: 'settingsSection', section })
      },
      openDialog,
      openDoc,
      closeDoc: (id) => {
        const target = id ?? state.activeId
        if (target !== null) dispatch({ type: 'closeDoc', id: target })
      },
      activateDoc: (id) => {
        dispatch({ type: 'activateDoc', id })
      },
      updateSettings,
      cycleTheme: () => {
        const next: Theme = resolvedTheme() === 'dark' ? 'light' : 'dark'
        void updateSettings({ general: { theme: next } })
      },
      toast,
      zoomBy: (delta) => {
        const index = ZOOM_STEPS.indexOf(state.zoom as (typeof ZOOM_STEPS)[number])
        const base = index === -1 ? ZOOM_STEPS.indexOf(100) : index
        const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, base + delta))]
        if (next !== undefined) dispatch({ type: 'zoom', zoom: next })
      },
      zoomTo: (zoom) => {
        dispatch({ type: 'zoom', zoom })
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
        dispatch({ type: 'page', page })
      },
      togglePage: (page) => {
        dispatch({ type: 'togglePage', page })
      },
      openExternal: (url) => {
        api.openExternal(url).catch(() => {
          toast(t.toast.linkBlocked)
        })
      },
      focusSearch: () => {
        dispatch({ type: 'sidebarTab', tab: 'search' })
        window.setTimeout(() => searchRef.current?.focus(), 0)
      }
    }),
    [api, openDialog, openDoc, state.activeId, state.zoom, toast, updateSettings]
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
        case 'file.print':
          actions.toast(t.toast.soon)
          break
        case 'file.close':
          actions.closeDoc()
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
