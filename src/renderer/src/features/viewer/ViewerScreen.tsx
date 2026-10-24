import type { ReactNode } from 'react'
import {
  IconDelete,
  IconHand,
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
  Command,
  IconButton,
  RadioGroup,
  Swatches,
  Tabs,
  Range
} from '@renderer/components/controls'
import { PagePlaceholder, PageThumb } from '@renderer/components/PagePlaceholder'
import {
  activeDoc,
  MARK_COLORS,
  TOOL_KEYS,
  useStore,
  type SidebarTab,
  type Tool
} from '@renderer/app/store'
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

const OUTLINE_DEMO: readonly { title: string; level: 1 | 2 }[] = [
  { title: '1. Предмет договора', level: 1 },
  { title: '2. Срок аренды', level: 1 },
  { title: '2.1. Продление', level: 2 },
  { title: '3. Арендная плата', level: 1 },
  { title: '3.1. Порядок расчётов', level: 2 },
  { title: '4. Ответственность сторон', level: 1 }
]

export function ViewerScreen(): React.JSX.Element {
  const { state, actions, searchRef } = useStore()
  const doc = activeDoc(state)
  const total = doc?.pages ?? 0
  const soon = (): void => {
    actions.toast(t.toast.soon)
  }
  const toolLabel = TOOL_META.find((m) => m.tool === state.tool)?.label ?? ''

  return (
    <div
      className={cx(
        s.viewer,
        !state.sidebar && s.noLeft,
        !state.props && s.noRight,
        state.pagesMode && s.pagesMode
      )}
      style={{ ['--scale' as string]: state.zoom / 100 }}
    >
      <div className={s.cmdbar} role="toolbar" aria-label="Команды">
        <Command
          icon={<IconSave />}
          label={t.cmd.save}
          hotkey="Ctrl+S"
          onClick={soon}
          disabled={!doc}
        />
        <Command
          icon={<IconPrint />}
          label={t.cmd.print}
          hotkey="Ctrl+P"
          onClick={soon}
          disabled={!doc}
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
          disabled={!doc}
          onClick={() => {
            actions.togglePagesMode()
          }}
        />
        <Command icon={<IconRotate />} label={t.cmd.rotate} onClick={soon} disabled={!doc} />
        <span className={s.spacer} />
        <div className={s.inline}>
          <div className={s.zoom}>
            <IconButton
              label={t.cmd.zoomOut}
              onClick={() => {
                actions.zoomBy(-1)
              }}
            >
              <IconZoomOut />
            </IconButton>
            <output className={s.zoomValue} aria-live="polite">
              {state.zoom}%
            </output>
            <IconButton
              label={t.cmd.zoomIn}
              onClick={() => {
                actions.zoomBy(1)
              }}
            >
              <IconZoomIn />
            </IconButton>
          </div>
          <label className={s.search}>
            <IconSearch />
            <input
              ref={searchRef}
              type="search"
              placeholder={t.cmd.search}
              aria-label={t.cmd.search}
              onFocus={() => {
                actions.setSidebarTab('search')
              }}
            />
          </label>
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

      {state.pagesMode && doc ? (
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
            {Array.from({ length: total }, (_, i) => (
              <PageThumb
                key={i}
                number={i + 1}
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
            {state.sidebarTab === 'thumbs' && (
              <div className={cx(s.sidebarBody, s.thumbs)}>
                {doc ? (
                  Array.from({ length: total }, (_, i) => (
                    <PageThumb
                      key={i}
                      number={i + 1}
                      current={state.page === i + 1}
                      onClick={() => {
                        actions.setPage(i + 1)
                      }}
                    />
                  ))
                ) : (
                  <p className={s.sideEmpty}>{t.viewer.emptyTitle}</p>
                )}
              </div>
            )}
            {state.sidebarTab === 'outline' && (
              <div className={s.sidebarBody}>
                {doc ? (
                  OUTLINE_DEMO.map((o) => (
                    <button
                      key={o.title}
                      type="button"
                      className={cx(s.outlineItem, o.level === 2 && s.lvl2)}
                      onClick={soon}
                    >
                      {o.title}
                    </button>
                  ))
                ) : (
                  <p className={s.sideEmpty}>{t.sidebar.outlineEmpty}</p>
                )}
              </div>
            )}
            {state.sidebarTab === 'search' && (
              <div className={s.sidebarBody}>
                <p className={s.sideEmpty}>{t.sidebar.searchEmpty}</p>
              </div>
            )}
          </aside>

          <section className={s.canvas} aria-label="Документ">
            {doc ? (
              Array.from({ length: Math.min(total, 3) }, (_, i) => (
                <PagePlaceholder key={i} number={i + 1} total={total} markColor={state.markColor} />
              ))
            ) : (
              <div className={s.canvasEmpty}>
                <h2>{t.viewer.emptyTitle}</h2>
                <p>{t.viewer.emptyLead}</p>
              </div>
            )}
          </section>

          <aside className={s.props} aria-label={t.cmd.props} hidden={!state.props}>
            <h3>{toolLabel}</h3>
            {state.tool !== 'select' && state.tool !== 'hand' && (
              <div className={s.pcard}>
                <div className={s.field}>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{t.props.color}</span>
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
              </div>
            )}
            {state.tool !== 'select' && state.tool !== 'hand' && (
              <div className={s.pcard}>
                <div className={s.field}>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{t.props.saveAs}</span>
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
                  {t.props.saveNote}
                </p>
              </div>
            )}
            {doc && (
              <div className={s.pcard}>
                <b style={{ fontWeight: 600 }}>{t.props.document}</b>
                <p className="muted" style={{ margin: 0, userSelect: 'text' }}>
                  {doc.name}
                  <br />
                  {doc.pages} {t.start.pages} · {t.viewer.paperA4}
                  <br />
                  {doc.path}
                </p>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  )
}
