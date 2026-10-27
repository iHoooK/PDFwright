import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode
} from 'react'
import { IconChevronDown } from '@renderer/icons'
import { t } from '@renderer/i18n'
import { cx } from './cx'
import s from './controls.module.css'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'subtle'
  icon?: ReactNode
}

export function Button({
  variant = 'default',
  icon,
  className,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(
        s.btn,
        variant === 'primary' && s.primary,
        variant === 'subtle' && s.subtle,
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  pressed?: boolean
  small?: boolean
}

/** Кнопка-иконка: доступное имя обязательно и дублируется подсказкой. */
export function IconButton({
  label,
  pressed,
  small,
  className,
  children,
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(s.iconBtn, small && s.iconBtnSmall, className)}
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...rest}
    >
      {children}
    </button>
  )
}

type CommandProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode
  label: string
  pressed?: boolean
  hotkey?: string
}

/** Команда панели: иконка 20 px над подписью, как в Проводнике Windows 11. */
export function Command({
  icon,
  label,
  pressed,
  hotkey,
  className,
  ...rest
}: CommandProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(s.cmd, className)}
      title={hotkey === undefined ? label : `${label} (${hotkey})`}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...rest}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  onLabel: string
  offLabel: string
  disabled?: boolean
  id?: string
}

export function Toggle({
  checked,
  onChange,
  onLabel,
  offLabel,
  disabled,
  id
}: ToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      className={s.toggle}
      disabled={disabled}
      onClick={() => {
        onChange(!checked)
      }}
    >
      <span>{checked ? onLabel : offLabel}</span>
      <i aria-hidden="true" />
    </button>
  )
}

interface SelectProps<T extends string> {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  label: string
  id?: string
}

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
  id
}: SelectProps<T>): React.JSX.Element {
  return (
    <span className={s.select}>
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = options.find((o) => o.value === event.target.value)
          if (next) onChange(next.value)
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <IconChevronDown />
    </span>
  )
}

interface RadioGroupProps<T extends string> {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}

export function RadioGroup<T extends string>({
  value,
  options,
  onChange,
  label
}: RadioGroupProps<T>): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={s.radio}
          onClick={() => {
            onChange(o.value)
          }}
        >
          <i aria-hidden="true" />
          {o.label}
        </button>
      ))}
    </div>
  )
}

interface TabsProps<T extends string> {
  value: T
  tabs: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  label
}: TabsProps<T>): React.JSX.Element {
  return (
    <div role="tablist" aria-label={label} className={s.tabs}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={s.tab}
          onClick={() => {
            onChange(tab.value)
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

interface SettingCardProps {
  icon?: ReactNode
  title: string
  hint?: string
  column?: boolean
  children?: ReactNode
}

/** Карточка параметра в стиле «Параметров» Windows. */
export function SettingCard({
  icon,
  title,
  hint,
  column,
  children
}: SettingCardProps): React.JSX.Element {
  return (
    <div className={cx(s.card, column && s.cardColumn)}>
      <div className={s.cardTitle}>
        {icon}
        <span>
          <b>{title}</b>
          {hint !== undefined && <small>{hint}</small>}
        </span>
      </div>
      {children}
    </div>
  )
}

export function Toast({
  message,
  action
}: {
  message: string | null
  /** Кнопка в сообщении: «Открыть» и подобное; щелчок закрывает сообщение. */
  action?: { label: string; run: () => void } | null
}): React.JSX.Element | null {
  if (message === null) return null
  return (
    <div className={s.toast} role="status" aria-live="polite">
      {message}
      {action && (
        <button type="button" className={s.toastAction} onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  )
}

interface SwatchesProps {
  colors: readonly string[]
  value: string
  onChange: (color: string) => void
  label: string
}

/**
 * Образцы цвета и «Свой цвет…» (системная палитра). Кнопки озвучиваются
 * названием цвета, а не кодом. Свой цвет применяется, когда палитру закрыли
 * (событие change), а не на каждое движение по ней: правка содержимого и
 * аннотаций документа пересобирает файл.
 */
export function Swatches({ colors, value, onChange, label }: SwatchesProps): React.JSX.Element {
  const customRef = useRef<HTMLInputElement | null>(null)
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => {
    const input = customRef.current
    if (!input) return
    const commit = (): void => {
      onChangeRef.current(input.value.toLowerCase())
    }
    input.addEventListener('change', commit)
    return () => {
      input.removeEventListener('change', commit)
    }
  }, [])
  const current = value.toLowerCase()
  const isCustom = !colors.some((color) => color.toLowerCase() === current)
  // Неуправляемое поле: палитра открывается с текущим цветом, значение читает change.
  useEffect(() => {
    if (customRef.current && /^#[0-9a-f]{6}$/.test(current)) customRef.current.value = current
  }, [current])
  return (
    <div className={s.swatches} role="group" aria-label={label}>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={s.swatch}
          style={{ background: color }}
          aria-label={t.colors.name(color)}
          title={t.colors.name(color)}
          aria-pressed={color.toLowerCase() === current}
          onClick={() => {
            onChange(color)
          }}
        />
      ))}
      <label
        className={cx(s.swatch, s.swatchCustom, isCustom && s.swatchCustomOn)}
        style={isCustom ? { background: value } : undefined}
        title={isCustom ? `${t.colors.custom} · ${t.colors.name(value)}` : t.colors.custom}
      >
        <input ref={customRef} type="color" aria-label={t.colors.custom} data-custom-color="" />
      </label>
    </div>
  )
}

type RangeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>

export function Range(props: RangeProps): React.JSX.Element {
  return <input type="range" className={s.range} {...props} />
}
