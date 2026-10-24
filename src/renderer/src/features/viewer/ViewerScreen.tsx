import type { ReactNode } from 'react'
import {
  IconDelete,
  IconHand,
  IconInfo,
  IconInsert,
  IconMarker,
  IconPages,
  IconPanelLeft,
  IconPanelRight,
  IconPen,
  IconPrint,
  IconRedo,
  IconRotate,
  IconSave,
  IconSearch,
  IconSelect,
  IconShapes,
  IconSign,
  IconSplit,
  IconText,
  IconUndo,
  IconZoomIn,
  IconZoomOut
} from '@renderer/icons'
import { t } from '@renderer/i18n'
import { cx } from '@renderer/components/cx'
import {
  Button,
  Command,
  IconButton,
  RadioGroup,
  Range,
  Swatches,
  Tabs
} from '@renderer/components/controls'
import {
  activeDoc,
  MARK_COLORS,
  TOOL_KEYS,
  useStore,
  type SidebarTab,
  type Tool
} from '@renderer/app/store'
import { DocumentView } from './DocumentView'
import { PageThumbnail } from './PageThumbnail'
import { PasswordDialog } from './PasswordDialog'
import { PropertiesDialog } from './PropertiesDialog'
import { OutlinePanel, SearchPanel, ThumbsPanel } from './SidebarPanels'
import s from './viewer.module.css'

const TOOL_META: readonly { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: 'select', label: t.cmd.select, icon: <IconSelect /> },
  { tool: 'hand', label: t.cmd.hand, icon: <IconHand /> },
  { tool: 'marker', label: t.cmd.marker, icon: <IconMarker /> },
  { tool: 'pen', label: t.cmd.pen, icon: <IconPen /> },
  { tool: 'shapes', label: t.cmd.shapes, icon: <IconShapes /> },
  { tool: 'text', label: t.cmd.text, icon: <IconText /> },
  { tool: 'sign', label: t.cmd.sign, icon: <IconSign /> }
]

const SIDEBAR_TABS: readonly { value: SidebarTab; label: string }[] = [
  { value: 'thumbs', label: t.sidebar.thumbs },
  { value: 'outline', label: t.sidebar.outline },
  { value: 'search', label: t.sidebar.search }
]

export function ViewerScreen(): React.JSX.Element {
  const { state, actions } = useStore()
  const tab = activeDoc(state)
  const doc = tab?.doc ?? null
  const readyDoc = tab && doc && tab.status === 'ready' ? { tab, doc } : null
  const ready = readyDoc !== null
  const soon = (): void => {
    actions.toast(t.toast.soon)
  }
  const toolLabel = TOOL_META.find((m) => m.tool === state.tool)?.label ?? ''
  const zoomLabel = `${state.resolvedZoom}%`

  return (
    <div
      className={cx(
        s.viewer,
        !state.sidebar && s.noLeft,
        !state.props && s.noRight,
        state.pagesMode && s.pagesMode
      )}
    >
      <div className={s.cmdbar} role="toolbar" aria-label="Команды">
        <Command
          icon={<IconSave />}
          label={t.cmd.save}
          hotkey="Ctrl+S"
          onClick={soon}
          disabled={!ready}
        />
        <Command
          icon={<IconPrint />}
          label={t.cmd.print}
          hotkey="Ctrl+P"
          onClick={actions.print}
          disabled={!ready}
        />
        <Command icon={<IconUndo />} label={t.cmd.undo} hotkey="Ctrl+Z" onClick={soon} disabled />
        <Command icon={<IconRedo />} label={t.cmd.redo} hotkey="Ctrl+Y" onClick={soon} disabled />
        <span className={s.sep} />
        {TOOL_META.map((m) => (
          <Command
            key={m.tool}
            icon={m.icon}
            label={m.label}
            hotkey={TOOL_KEYS[m.tool]}
            pressed={state.tool === m.tool}
            onClick={() => {
              actions.setTool(m.tool)
            }}
          />
        ))}
        <span className={s.sep} />
        <Command
          icon={<IconPages />}
          label={t.cmd.pages}
          pressed={state.pagesMode}
          disabled={!ready}
          onClick={() => {
            actions.togglePagesMode()
          }}
        />
        <Command
          icon={<IconRotate />}
          label={t.cmd.rotate}
          hotkey="Ctrl+R"
          onClick={actions.rotate}
          disabled={!ready}
        />
        <span className={s.spacer} />
        <div className={s.inline}>
          <div className={s.zoom}>
            <IconButton
              label={t.cmd.zoomOut}
              onClick={() => {
                actions.zoomBy(-1)
              }}
              disabled={!ready}
            >
              <IconZoomOut />
            </IconButton>
            <button
              type="button"
              className={s.zoomValue}
              title={t.cmd.zoomMenu}
              aria-label={`${t.cmd.zoomMenu}: ${zoomLabel}`}
              onClick={actions.cycleZoomMode}
              disabled={!ready}
            >
              {zoomLabel}
            </button>
            <IconButton
              label={t.cmd.zoomIn}
              onClick={() => {
                actions.zoomBy(1)
              }}
              disabled={!ready}
            >
              <IconZoomIn />
            </IconButton>
          </div>
          <IconButton
            label={t.cmd.search}
            pressed={state.sidebar && state.sidebarTab === 'search'}
            onClick={actions.focusSearch}
            disabled={!ready}
          >
            <IconSearch />
          </IconButton>
          <IconButton
            label={t.cmd.sidebar}
            pressed={state.sidebar}
            onClick={() => {
              actions.toggleSidebar()
            }}
          >
            <IconPanelLeft />
          </IconButton>
          <IconButton
            label={t.cmd.props}
            pressed={state.props}
            onClick={() => {
              actions.toggleProps()
            }}
          >
            <IconPanelRight />
          </IconButton>
        </div>
      </div>

      {state.pagesMode && readyDoc ? (
        <>
          <div className={s.pagesActions} role="toolbar" aria-label={t.cmd.pages}>
            <span className={s.count}>{t.pages.selected(state.selectedPages.size)}</span>
            <span className={s.spacer} />
            <Command
              icon={<IconRotate />}
              label={t.pages.rotate}
              onClick={soon}
              disabled={state.selectedPages.size === 0}
            />
            <Command
              icon={<IconSplit />}
              label={t.pages.extract}
              onClick={soon}
              disabled={state.selectedPages.size === 0}
            />
            <Command icon={<IconInsert />} label={t.pages.insert} onClick={soon} />
            <Command
              icon={<IconDelete />}
              label={t.pages.remove}
              onClick={soon}
              disabled={state.selectedPages.size === 0}
            />
          </div>
          <div className={s.pagesGrid}>
            {Array.from({ length: readyDoc.tab.pages }, (_, i) => (
              <PageThumbnail
                key={i}
                doc={readyDoc.doc}
                pageNumber={i + 1}
                rotation={state.rotation}
                selected={state.selectedPages.has(i + 1)}
                onClick={() => {
                  actions.togglePage(i + 1)
                }}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <aside className={s.sidebar} aria-label={t.cmd.sidebar} hidden={!state.sidebar}>
            <Tabs
              value={state.sidebarTab}
              tabs={SIDEBAR_TABS}
              onChange={actions.setSidebarTab}
              label={t.cmd.sidebar}
            />
            {!readyDoc ? (
              <p className={s.sideEmpty}>{t.viewer.emptyTitle}</p>
            ) : state.sidebarTab === 'thumbs' ? (
              <ThumbsPanel tab={readyDoc.tab} doc={readyDoc.doc} />
            ) : state.sidebarTab === 'outline' ? (
              <OutlinePanel doc={readyDoc.doc} />
            ) : (
              <SearchPanel />
            )}
          </aside>

          {readyDoc ? (
            <DocumentView tab={readyDoc.tab} doc={readyDoc.doc} />
          ) : (
            <section className={cx(s.canvas, s.canvasEmpty)} aria-label="Документ">
              {tab?.status === 'loading' ? (
                <>
                  <h2>{t.viewer.loading}</h2>
                  <p>{tab.name}</p>
                </>
              ) : tab?.status === 'error' ? (
                <>
                  <h2>{t.viewer.errorTitle}</h2>
                  <p>{tab.error}</p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <Button
                      onClick={() => {
                        actions.openPath(tab.path)
                      }}
                    >
                      {t.viewer.retry}
                    </Button>
                    <Button
                      onClick={() => {
                        actions.closeDoc(tab.id)
                      }}
                    >
                      {t.viewer.closeTab}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h2>{t.viewer.emptyTitle}</h2>
                  <p>{t.viewer.emptyLead}</p>
                </>
              )}
            </section>
          )}

          <aside className={s.props} aria-label={t.cmd.props} hidden={!state.props}>
            <h3>{toolLabel}</h3>
            {state.tool !== 'select' && state.tool !== 'hand' && (
              <div className={s.pcard}>
                <div className={s.field}>
                  <span className={s.fieldLabel}>{t.props.color}</span>
                  <Swatches
                    colors={MARK_COLORS}
                    value={state.markColor}
                    onChange={actions.setMarkColor}
                    label={t.props.color}
                  />
                </div>
                <div className={s.field}>
                  <label htmlFor="opacity">{t.props.opacity} · 55%</label>
                  <Range id="opacity" min={10} max={100} defaultValue={55} />
                </div>
                <div className={s.field}>
                  <span className={s.fieldLabel}>{t.props.saveAs}</span>
                  <RadioGroup
                    value="annotation"
                    label={t.props.saveAs}
                    options={[
                      { value: 'annotation', label: t.props.asAnnotation },
                      { value: 'content', label: t.props.asContent }
                    ]}
                    onChange={soon}
                  />
                </div>
                <p className="muted" style={{ margin: 0 }}>
                  {t.props.annotationsSoon}
                </p>
              </div>
            )}
            {tab && (
              <div className={s.pcard}>
                <b style={{ fontWeight: 600 }}>{t.props.document}</b>
                <p className="muted" style={{ margin: 0, userSelect: 'text' }}>
                  {tab.name}
                  <br />
                  {ready
                    ? `${tab.pages} ${t.start.pages}`
                    : tab.status === 'loading'
                      ? t.viewer.loading
                      : t.viewer.errorTitle}
                  <br />
                  {tab.path}
                </p>
                <Button icon={<IconInfo />} onClick={actions.openProperties} disabled={!ready}>
                  {t.props.properties}
                </Button>
              </div>
            )}
          </aside>
        </>
      )}
      <PasswordDialog />
      <PropertiesDialog />
    </div>
  )
}
