import { useState } from 'react'
import { IconOpen, IconSave, IconSettings } from '@renderer/icons'
import {
  Button,
  Command,
  IconButton,
  RadioGroup,
  SelectField,
  SettingCard,
  Swatches,
  Tabs,
  Toggle
} from '@renderer/components/controls'
import { PageThumb } from '@renderer/components/PagePlaceholder'
import { MARK_COLORS } from '@renderer/app/store'

/**
 * Витрина компонентов для разработки (план 1.2). Доступна только в dev-сборке
 * по адресу renderer с `?kit`; в упакованном приложении экран не монтируется.
 */
export function KitScreen(): React.JSX.Element {
  const [toggle, setToggle] = useState(true)
  const [radio, setRadio] = useState('a')
  const [tab, setTab] = useState('one')
  const [color, setColor] = useState<string>(MARK_COLORS[0])
  const [select, setSelect] = useState('x')

  const block: React.CSSProperties = {
    display: 'grid',
    gap: 12,
    padding: 16,
    border: '1px solid var(--line)',
    borderRadius: 8
  }
  const row: React.CSSProperties = {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap'
  }

  return (
    <div style={{ overflow: 'auto', padding: 28, display: 'grid', gap: 20, alignContent: 'start' }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Компоненты «Ленты»</h1>
      <div style={block}>
        <b>Button</b>
        <div style={row}>
          <Button variant="primary">Primary</Button>
          <Button>Default</Button>
          <Button variant="subtle">Subtle</Button>
          <Button icon={<IconOpen />}>С иконкой</Button>
          <Button disabled>Disabled</Button>
        </div>
      </div>
      <div style={block}>
        <b>IconButton</b>
        <div style={row}>
          <IconButton label="Параметры">
            <IconSettings />
          </IconButton>
          <IconButton label="Нажата" pressed>
            <IconSettings />
          </IconButton>
          <IconButton label="Выключена" disabled>
            <IconSettings />
          </IconButton>
          <IconButton label="Маленькая" small>
            <IconSettings />
          </IconButton>
        </div>
      </div>
      <div style={block}>
        <b>Command</b>
        <div style={row}>
          <Command icon={<IconSave />} label="Сохранить" hotkey="Ctrl+S" />
          <Command icon={<IconSave />} label="Нажата" pressed />
          <Command icon={<IconSave />} label="Выключена" disabled />
        </div>
      </div>
      <div style={block}>
        <b>Toggle · Select · Radio</b>
        <div style={row}>
          <Toggle checked={toggle} onChange={setToggle} onLabel="Вкл." offLabel="Выкл." />
          <SelectField
            label="Пример"
            value={select}
            onChange={setSelect}
            options={[
              { value: 'x', label: 'Как в системе' },
              { value: 'y', label: 'Светлая' }
            ]}
          />
        </div>
        <RadioGroup
          label="Пример"
          value={radio}
          onChange={setRadio}
          options={[
            { value: 'a', label: 'Аннотацию' },
            { value: 'b', label: 'Часть содержимого страницы' }
          ]}
        />
      </div>
      <div style={block}>
        <b>Tabs · Swatches · PageThumb</b>
        <Tabs
          label="Пример"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'one', label: 'Страницы' },
            { value: 'two', label: 'Закладки' }
          ]}
        />
        <Swatches colors={MARK_COLORS} value={color} onChange={setColor} label="Цвет" />
        <div style={{ ...row, width: 420 }}>
          <div style={{ width: 120 }}>
            <PageThumb number={1} current onClick={() => undefined} />
          </div>
          <div style={{ width: 120 }}>
            <PageThumb number={2} selected onClick={() => undefined} />
          </div>
          <div style={{ width: 120 }}>
            <PageThumb number={3} selected={false} onClick={() => undefined} />
          </div>
        </div>
      </div>
      <SettingCard icon={<IconSettings />} title="SettingCard" hint="Подпись параметра">
        <Toggle checked={toggle} onChange={setToggle} onLabel="Вкл." offLabel="Выкл." />
      </SettingCard>
    </div>
  )
}
