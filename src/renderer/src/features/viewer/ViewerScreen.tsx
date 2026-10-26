import type { ReactNode } from 'react'
import {
  IconCopy,
  IconDelete,
  IconEdit,
  IconHand,
  IconInfo,
  IconInsert,
  IconMarker,
  IconNote,
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
import { Button, Command, IconButton, Tabs } from '@renderer/components/controls'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { activeDoc, TOOL_KEYS, useStore, type SidebarTab, type Tool } from '@renderer/app/store'
import { MergeDialog } from '@renderer/features/tools/MergeDialog'
import { SplitDialog } from '@renderer/features/tools/SplitDialog'
import { ImageCommand, MarkupPanel } from '@renderer/features/markup/MarkupPanel'
import { FormsPanel } from '@renderer/features/forms/FormsPanel'
import { DocumentView } from './DocumentView'
import { PagesGrid } from './PagesGrid'
import { PasswordDialog } from './PasswordDialog'
import { PropertiesDialog } from './PropertiesDialog'
import { ProtectDialog } from '@renderer/features/protect/ProtectDialog'
import { OutlinePanel, SearchPanel, ThumbsPanel } from './SidebarPanels'
import s from './viewer.module.css'

const TOOL_META: readonly { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: 'select', label: t.cmd.select, icon: <IconSelect /> },
  { tool: 'edit', label: t.cmd.edit, icon: <IconEdit /> },
  { tool: 'hand', label: t.cmd.hand, icon: <IconHand /> },
  { tool: 'marker', label: t.cmd.marker, icon: <IconMarker /> },
  { tool: 'pen', label: t.cmd.pen, icon: <IconPen /> },
  { tool: 'shapes', label: t.cmd.shapes, icon: <IconShapes /> },
  { tool: 'text', label: t.cmd.text, icon: <IconText /> },
  { tool: 'note', label: t.annotations.note, icon: <IconNote /> },
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
  const busy = tab?.busy ?? false
  const canEdit = ready && !busy
  const dirty = readyDoc?.tab.dirty ?? false
  const canUndo = (readyDoc?.tab.history.length ?? 0) > 0
  const canRedo = (readyDoc?.tab.future.length ?? 0) > 0
  const selectedCount = state.selectedPages.size
  const toolLabel = TOOL_META.find((m) => m.tool === state.tool)?.label ?? ''
  const zoomLabel = `${state.resolvedZoom}%`
  const closing =
    state.closeConfirm !== null ? state.docs.find((d) => d.id === state.closeConfirm) : null

  return (
    <div
      className={cx(
        s.viewer,
        !state.sidebar && s.noLeft,
        !state.props && s.noRight,
        state.pagesMode && s.pagesMode
      )}
    >
      <div className={s.cmdbar} role="toolbar" aria-label={t.a11y.commands}>
        <Command
          icon={<IconSave />}
          label={t.cmd.save}
          hotkey="Ctrl+S"
          onClick={() => void actions.save()}
          disabled={!canEdit || !dirty}
        />
        <Command
          icon={<IconPrint />}
          label={t.cmd.print}
          hotkey="Ctrl+P"
          onClick={actions.print}
          disabled={!ready}
        />
        <Command
          icon={<IconUndo />}
          label={t.cmd.undo}
          hotkey="Ctrl+Z"
          onClick={actions.undo}
          disabled={!canEdit || !canUndo}
        />
        <Command
          icon={<IconRedo />}
          label={t.cmd.redo}
          hotkey="Ctrl+Y"
          onClick={actions.redo}
          disabled={!canEdit || !canRedo}
        />
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
        <ImageCommand disabled={!canEdit || state.pagesMode} />
        <span className={s.sep} />
        <Command
          icon={<IconPages />}
          label={t.cmd.pages}
          hotkey="Ctrl+G"
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
            <span className={s.count} title={t.pages.hint}>
              {t.pages.selected(selectedCount)}
            </span>
            <Button
              variant="subtle"
              onClick={
                selectedCount === readyDoc.tab.pages ? actions.selectNone : actions.selectAll
              }
            >
              {selectedCount === readyDoc.tab.pages ? t.pages.selectNone : t.pages.selectAll}
            </Button>
            <span className={s.spacer} />
            <Command
              icon={<IconRotate />}
              label={t.pages.rotateCw}
              onClick={() => {
                actions.rotateSelected(90)
              }}
              disabled={!canEdit || selectedCount === 0}
            />
            <Command
              icon={<IconRotate style={{ transform: 'scaleX(-1)' }} />}
              label={t.pages.rotateCcw}
              onClick={() => {
                actions.rotateSelected(270)
              }}
              disabled={!canEdit || selectedCount === 0}
            />
            <Command
              icon={<IconCopy />}
              label={t.pages.duplicate}
              onClick={actions.duplicateSelected}
              disabled={!canEdit || selectedCount === 0}
            />
            <Command
              icon={<IconSplit />}
              label={t.pages.extract}
              onClick={actions.extractSelected}
              disabled={!canEdit || selectedCount === 0}
            />
            <Command
              icon={<IconInsert />}
              label={t.pages.insert}
              onClick={actions.insertFromFile}
              disabled={!canEdit}
            />
            <Command
              icon={<IconPages />}
              label={t.pages.blank}
              onClick={actions.insertBlank}
              disabled={!canEdit}
            />
            <Command
              icon={<IconDelete />}
              label={t.pages.remove}
              hotkey="Delete"
              onClick={actions.deleteSelected}
              disabled={!canEdit || selectedCount === 0 || selectedCount >= readyDoc.tab.pages}
            />
          </div>
          <PagesGrid tab={readyDoc.tab} doc={readyDoc.doc} />
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
            <section className={cx(s.canvas, s.canvasEmpty)} aria-label={t.a11y.document}>
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
                        actions.requestCloseDoc(tab.id)
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
            {readyDoc && <MarkupPanel toolLabel={toolLabel} />}
            {readyDoc && <FormsPanel />}
            {tab && (
              <div className={s.pcard}>
                <b style={{ fontWeight: 600 }}>{t.props.document}</b>
                <p
                  className="muted"
                  style={{ margin: 0, userSelect: 'text', overflowWrap: 'anywhere' }}
                >
                  {tab.name}
                  <br />
                  {ready
                    ? t.start.pageCount(tab.pages)
                    : tab.status === 'loading'
                      ? t.viewer.loading
                      : t.viewer.errorTitle}
                  <br />
                  {tab.path}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button icon={<IconInfo />} onClick={actions.openProperties} disabled={!ready}>
                    {t.props.properties}
                  </Button>
                  <Button onClick={() => void actions.saveAs()} disabled={!canEdit}>
                    {t.cmd.saveAs}
                  </Button>
                  <Button
                    title={t.compare.commandHint}
                    onClick={actions.compareWith}
                    disabled={!ready || busy}
                  >
                    {t.compare.command}
                  </Button>
                </div>
              </div>
            )}
          </aside>
        </>
      )}
      {busy && (
        <div className={s.busy} role="status">
          {t.viewer.busy}
        </div>
      )}
      <PasswordDialog />
      <PropertiesDialog />
      <ProtectDialog />
      <MergeDialog />
      <SplitDialog />
      <ConfirmDialog
        open={closing !== null && closing !== undefined}
        title={t.confirm.closeTitle}
        message={t.confirm.closeText(closing?.name ?? '')}
        onCancel={() => {
          actions.confirmClose('cancel')
        }}
        actions={[
          {
            label: t.confirm.cancel,
            onClick: () => {
              actions.confirmClose('cancel')
            }
          },
          {
            label: t.confirm.discard,
            onClick: () => {
              actions.confirmClose('discard')
            }
          },
          {
            label: t.confirm.save,
            variant: 'primary',
            onClick: () => {
              actions.confirmClose('save')
            }
          }
        ]}
      />
    </div>
  )
}
