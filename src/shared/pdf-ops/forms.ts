import fontkit from '@pdf-lib/fontkit'
import {
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFStream,
  PDFTextField,
  type PDFDocument,
  type PDFField,
  type PDFForm,
  type PDFFont
} from 'pdf-lib'
import { load, PdfOpsError, PRODUCER } from './document'

/**
 * Заполнение форм (AcroForms) на pdf-lib. Значение поля в интерфейсе и здесь
 * одно и то же: текст — строка; флажок и переключатель — имя включённого
 * состояния (экспортное значение) или `Off`; списки — массив выбранных значений.
 */
export type FormValue = string | readonly string[]
/** Несохранённые значения полей по полному имени поля. */
export type FormValues = Readonly<Record<string, FormValue>>

/** Состояние «выключено» у флажков и переключателей. */
export const FORM_OFF = 'Off'

export type FormFieldKind =
  'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'button' | 'signature'

export interface FormFieldInfo {
  name: string
  kind: FormFieldKind
  value: FormValue
  /** Варианты списка или экспортные значения переключателей. */
  options: string[]
  readOnly: boolean
}

export interface ApplyFormsOptions {
  /** Шрифт внешнего вида полей (PT Sans): без него кириллица не записывается. */
  font: Uint8Array | null
  /** Вплавить поля в содержимое страниц: значения остаются, полей больше нет. */
  flatten?: boolean
}

function kindOf(field: PDFField): FormFieldKind {
  if (field instanceof PDFTextField) return 'text'
  if (field instanceof PDFCheckBox) return 'checkbox'
  if (field instanceof PDFRadioGroup) return 'radio'
  if (field instanceof PDFDropdown) return 'dropdown'
  if (field instanceof PDFOptionList) return 'list'
  if (field instanceof PDFSignature) return 'signature'
  return 'button'
}

interface ButtonState {
  /** Имя включённого состояния виджета. */
  on: PDFName
  /** Экспортное значение: из /Opt, если он есть, иначе имя состояния — как у pdf.js. */
  value: string
}

function buttonStates(field: PDFCheckBox | PDFRadioGroup): ButtonState[] {
  const exports = field.acroField.getExportValues() ?? []
  const states: ButtonState[] = []
  field.acroField.getWidgets().forEach((widget, index) => {
    const on = widget.getOnValue()
    if (!on || states.some((s) => s.on === on)) return
    states.push({ on, value: exports[index]?.decodeText() ?? on.decodeText() })
  })
  return states
}

function buttonValue(field: PDFCheckBox | PDFRadioGroup): string {
  const value = field.acroField.getValue()
  if (value === PDFName.of(FORM_OFF)) return FORM_OFF
  return buttonStates(field).find((s) => s.on === value)?.value ?? value.decodeText()
}

function fieldValue(field: PDFField): FormValue {
  if (field instanceof PDFTextField) return field.getText() ?? ''
  if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) return buttonValue(field)
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getSelected()
  return ''
}

function fieldOptions(field: PDFField): string[] {
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getOptions()
  if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup)
    return buttonStates(field).map((s) => s.value)
  return []
}

/** Поля формы документа с текущими значениями (пустой список, если формы нет). */
export async function readFormFields(bytes: Uint8Array): Promise<FormFieldInfo[]> {
  const doc = await load(bytes)
  return doc
    .getForm()
    .getFields()
    .map((field) => ({
      name: field.getName(),
      kind: kindOf(field),
      value: fieldValue(field),
      options: fieldOptions(field),
      readOnly: field.isReadOnly()
    }))
}

const asText = (value: FormValue): string => (typeof value === 'string' ? value : value.join(', '))
const asList = (value: FormValue): string[] =>
  typeof value === 'string' ? (value.length > 0 ? [value] : []) : [...value]

function setButton(form: PDFForm, field: PDFCheckBox | PDFRadioGroup, value: string): void {
  if (value === FORM_OFF || value.length === 0) {
    if (field instanceof PDFCheckBox) field.uncheck()
    else field.clear()
    return
  }
  const states = buttonStates(field)
  const state =
    states.find((s) => s.value === value) ?? states.find((s) => s.on.decodeText() === value)
  if (field instanceof PDFCheckBox && !state) {
    // Обычный флажок с одним включённым состоянием: check() ставит его.
    field.check()
    return
  }
  if (!state) throw new PdfOpsError(`У поля «${field.getName()}» нет варианта «${value}».`)
  field.acroField.setValue(state.on)
  form.markFieldAsDirty(field.ref)
}

function setValue(form: PDFForm, field: PDFField, value: FormValue): void {
  if (field instanceof PDFTextField) {
    const max = field.getMaxLength()
    const text = asText(value)
    field.setText(max !== undefined ? text.slice(0, max) : text)
  } else if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) {
    setButton(form, field, asText(value))
  } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const list = asList(value)
    if (list.length === 0) field.clear()
    else if (field instanceof PDFDropdown) field.select(list.length === 1 ? (list[0] ?? '') : list)
    else field.select(list)
  }
}

/**
 * Внешний вид изменённых полей и полей без него — встроенным шрифтом. Поле,
 * которое pdf-lib не умеет нарисовать (редкие виды кнопок), оставляем как было.
 */
function updateAppearances(doc: PDFDocument, font: PDFFont | null): void {
  for (const field of doc.getForm().getFields()) {
    if (!field.needsAppearancesUpdate()) continue
    try {
      if (font) field.defaultUpdateAppearances(font)
      else if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup)
        field.defaultUpdateAppearances()
    } catch (error) {
      console.warn(`[forms] вид поля «${field.getName()}» не обновлён:`, error)
    }
  }
}

/**
 * pdf-lib вплавляет только виджеты с внешним видом по ссылке. Пустой подписи
 * вида нет вовсе, а у некоторых файлов он записан прямо в словаре — такие
 * случаи приводим к ссылке (пустой вид для полей без него).
 */
function prepareFlatten(doc: PDFDocument): void {
  const N = PDFName.of('N')
  for (const field of doc.getForm().getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      const ap = widget.dict.lookupMaybe(PDFName.of('AP'), PDFDict)
      const normal = ap?.get(N)
      // Ссылка на вид или словарь состояний флажка — pdf-lib справится сам.
      if (normal instanceof PDFRef || normal instanceof PDFDict) continue
      const rect = widget.getRectangle()
      const stream =
        normal instanceof PDFStream
          ? normal
          : doc.context.formXObject([], { BBox: [0, 0, rect.width, rect.height] })
      widget.setNormalAppearance(doc.context.register(stream))
    }
  }
}

/**
 * Записывает значения полей в документ и обновляет их внешний вид шрифтом
 * options.font — так значения на кириллице видны и в других просмотрщиках.
 * С flatten поля вплавляются в страницы: в документе остаётся только их вид.
 */
export async function applyFormValues(
  bytes: Uint8Array,
  values: FormValues,
  options: ApplyFormsOptions
): Promise<Uint8Array> {
  const doc = await load(bytes)
  const form = doc.getForm()
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name)
    if (!field) throw new PdfOpsError(`В документе нет поля «${name}».`)
    if (!field.isReadOnly()) setValue(form, field, value)
  }
  let font: PDFFont | null = null
  if (options.font) {
    doc.registerFontkit(fontkit)
    font = await doc.embedFont(options.font, { subset: true })
  }
  updateAppearances(doc, font)
  if (options.flatten) {
    prepareFlatten(doc)
    form.flatten({ updateFieldAppearances: false })
  }
  doc.setProducer(PRODUCER)
  doc.setModificationDate(new Date())
  // Вид полей уже обновлён: иначе pdf-lib перерисует их Helvetica без кириллицы.
  return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false })
}
