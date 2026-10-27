import { FORM_OFF, type FormValue, type FormValues } from '@shared/pdf-ops/forms'
import {
  AnnotationLayer,
  AnnotationType,
  type PageViewport,
  type PDFPageProxy,
  type PdfDocument
} from '@renderer/pdf-engine/engine'
import { sameValue, supportsSelection, withFieldValue } from './form-values'

/**
 * Слой форм pdf.js поверх страницы: поля AcroForm как обычные элементы ввода.
 * Источник правды — значения вкладки (`DocTab.forms`): перед рендером они
 * записываются в annotationStorage документа, а правки в полях уходят обратно
 * через onChange. Если значения поменялись не из полей (отмена, повтор, сброс),
 * слой рисуется заново с новыми значениями.
 */

/** Данные виджета из `page.getAnnotations()` — только то, что нужно слою. */
interface WidgetData {
  id: string
  annotationType: number
  fieldName: string
  fieldType?: string
  fieldValue?: unknown
  checkBox?: boolean
  radioButton?: boolean
  exportValue?: string
  buttonValue?: string | null
}

type FieldKind = 'text' | 'checkbox' | 'radio' | 'choice'

interface Widget {
  data: WidgetData
  kind: FieldKind
}

export interface FormLayerCallbacks {
  /**
   * coalesce склеивает набор текста в одном поле в один шаг отмены. value null —
   * поле вернулось к значению из файла: несохранённой правки у него больше нет.
   */
  onChange: (name: string, value: FormValue | null, coalesce?: string) => void
  onUndo: () => void
  onRedo: () => void
}

interface Options extends FormLayerCallbacks {
  doc: PdfDocument
  page: PDFPageProxy
  viewport: PageViewport
  div: HTMLDivElement
  /** Холсты вида флажков и переключателей из рендера страницы. */
  canvases: Map<string, HTMLCanvasElement>
}

type Storage = PdfDocument['annotationStorage']

function kindOf(data: WidgetData): FieldKind | null {
  if (data.annotationType !== AnnotationType.WIDGET || !data.fieldName) return null
  if (data.fieldType === 'Tx') return 'text'
  if (data.fieldType === 'Ch') return 'choice'
  if (data.fieldType === 'Btn' && data.checkBox) return 'checkbox'
  if (data.fieldType === 'Btn' && data.radioButton) return 'radio'
  return null
}

const toList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string' && value.trim().length > 0
      ? [value]
      : []

/** Значение поля в файле — пока пользователь его не менял. */
function fileValue({ data, kind }: Widget): FormValue {
  if (kind === 'choice') return toList(data.fieldValue)
  if (kind === 'text') return typeof data.fieldValue === 'string' ? data.fieldValue : ''
  return typeof data.fieldValue === 'string' && data.fieldValue.length > 0
    ? data.fieldValue
    : FORM_OFF
}

/** Что должно лежать в annotationStorage у виджета при значении поля value. */
function storageEntry({ data, kind }: Widget, value: FormValue): Record<string, unknown> {
  const text = typeof value === 'string' ? value : value.join(', ')
  if (kind === 'text') return { value: text, formattedValue: text }
  if (kind === 'checkbox') return { value: text === data.exportValue }
  if (kind === 'radio') return { value: text === data.buttonValue }
  return { value: toList(value) }
}

function storedMatches(storage: Storage, widget: Widget, value: FormValue): boolean {
  const stored = (storage.getValue(widget.data.id, {}) as { value?: unknown }).value
  const expected = storageEntry(widget, value).value
  if (widget.kind === 'choice') return sameValue(toList(stored), expected as string[])
  return stored === expected
}

/**
 * Значение поля после правки виджета пользователем; null — правка поле не меняет.
 * Читаем сам элемент: событие input у флажка приходит раньше, чем pdf.js
 * обновляет annotationStorage по change.
 */
function valueFromElement(element: HTMLElement, widget: Widget): FormValue | null {
  switch (widget.kind) {
    case 'text':
      return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.value
        : null
    case 'checkbox':
      if (!(element instanceof HTMLInputElement)) return null
      return element.checked ? (widget.data.exportValue ?? 'Yes') : FORM_OFF
    case 'radio':
      return element instanceof HTMLInputElement && element.checked
        ? (widget.data.buttonValue ?? null)
        : null
    case 'choice':
      // Пустой пункт « » pdf.js добавляет в выпадающий список без значения.
      return element instanceof HTMLSelectElement
        ? Array.from(element.selectedOptions, (o) => o.value).filter((v) => v.trim().length > 0)
        : null
  }
}

/** Ссылки слою не нужны (виджеты без действий), но pdf.js обращается к сервису. */
const NO_LINKS = {
  eventBus: null,
  externalLinkEnabled: false,
  externalLinkTarget: 0,
  externalLinkRel: '',
  getDestinationHash: () => '#',
  getAnchorUrl: () => '#',
  addLinkAttributes: () => undefined,
  goToDestination: () => Promise.resolve(),
  goToPage: () => undefined,
  executeNamedAction: () => undefined,
  executeSetOCGState: () => Promise.resolve()
}

export class FormLayerController {
  private widgets: Widget[] = []
  private values: FormValues = {}
  private rendering: Promise<void> | null = null
  private pending: FormValues | null = null
  private focusRun = 0
  private destroyed = false
  /**
   * Слой перерисовывается: поле в фокусе, удаляемое из DOM, присылает change
   * со старым значением — это не правка пользователя (иначе отмена тут же
   * перезаписывается этим значением).
   */
  private replacing = false
  /**
   * Своя копия холстов: AnnotationLayer вынимает их из переданной карты, а при
   * перерисовке слоя (отмена, повтор) они нужны снова.
   */
  private readonly canvases: Map<string, HTMLCanvasElement>

  constructor(private readonly options: Options) {
    const { div } = options
    this.canvases = new Map(options.canvases)
    div.addEventListener('input', this.onInput)
    div.addEventListener('change', this.onInput)
    div.addEventListener('keydown', this.onKeyDown)
    div.addEventListener('focusin', this.onFocus)
  }

  /** Есть ли на странице поля, которые слой показывает. */
  get hasFields(): boolean {
    return this.widgets.length > 0
  }

  async init(values: FormValues): Promise<void> {
    const annotations = (await this.options.page.getAnnotations({
      intent: 'display'
    })) as WidgetData[]
    this.widgets = annotations.flatMap((data) => {
      const kind = kindOf(data)
      return kind ? [{ data, kind }] : []
    })
    if (this.widgets.length > 0 && !this.destroyed) await this.render(values)
  }

  /** Новые значения вкладки: перерисовываем, только если поля показывают другое. */
  sync(values: FormValues): void {
    if (this.destroyed || this.widgets.length === 0) return
    if (this.rendering) {
      this.pending = values
      return
    }
    this.values = values
    const storage = this.options.doc.annotationStorage
    const stale = this.widgets.some((w) => !storedMatches(storage, w, this.valueOf(w)))
    if (stale) void this.render(values)
  }

  destroy(): void {
    this.destroyed = true
    const { div } = this.options
    div.removeEventListener('input', this.onInput)
    div.removeEventListener('change', this.onInput)
    div.removeEventListener('keydown', this.onKeyDown)
    div.removeEventListener('focusin', this.onFocus)
    div.replaceChildren()
  }

  private valueOf(widget: Widget): FormValue {
    return this.values[widget.data.fieldName] ?? fileValue(widget)
  }

  private render(values: FormValues): Promise<void> {
    this.values = values
    const run = (async () => {
      const { doc, page, viewport, div } = this.options
      const storage = doc.annotationStorage
      for (const widget of this.widgets) {
        storage.setValue(widget.data.id, storageEntry(widget, this.valueOf(widget)))
      }
      const focusedId =
        document.activeElement instanceof HTMLElement && div.contains(document.activeElement)
          ? document.activeElement.getAttribute('data-element-id')
          : null
      const fieldObjects = await doc.getFieldObjects()
      if (this.destroyed) return
      this.replacing = true
      try {
        div.replaceChildren()
      } finally {
        this.replacing = false
      }
      const layer = new AnnotationLayer({
        div,
        page,
        viewport,
        annotationStorage: storage,
        annotationCanvasMap: new Map(this.canvases),
        linkService: NO_LINKS,
        accessibilityManager: null,
        annotationEditorUIManager: null,
        structTreeLayer: null,
        commentManager: null
      })
      await layer.render({
        viewport: viewport.clone({ dontFlip: true }),
        div,
        annotations: this.widgets.map((w) => w.data),
        page,
        linkService: NO_LINKS as never,
        annotationStorage: storage,
        renderForms: true,
        enableScripting: false,
        hasJSActions: false,
        fieldObjects
      })
      if (focusedId !== null && div.isConnected) {
        const element = div.querySelector<HTMLElement>(`[data-element-id="${focusedId}"]`)
        element?.focus()
        if (
          (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
          supportsSelection(element.tagName, element.type)
        ) {
          const end = element.value.length
          element.setSelectionRange(end, end)
        }
      }
    })()
    this.rendering = run
    void run
      .catch((error: unknown) => {
        console.error('[forms] слой форм не отрисован:', error)
      })
      .finally(() => {
        this.rendering = null
        const next = this.pending
        this.pending = null
        if (next) this.sync(next)
      })
    return run.catch(() => undefined)
  }

  private readonly onInput = (event: Event): void => {
    const target = event.target
    if (this.replacing || !(target instanceof HTMLElement)) return
    const id = target.getAttribute('data-element-id')
    const widget = this.widgets.find((w) => w.data.id === id)
    if (!widget) return
    const value = valueFromElement(target, widget)
    if (value === null || sameValue(value, this.valueOf(widget))) return
    const name = widget.data.fieldName
    // Значение как в файле — правки поля больше нет (флажок переключён дважды).
    const change = sameValue(value, fileValue(widget)) ? null : value
    this.values = withFieldValue(this.values, name, change)
    this.options.onChange(
      name,
      change,
      widget.kind === 'text' ? `${name}:${this.focusRun}` : undefined
    )
  }

  /** Новый заход в поле — новый шаг отмены для набора текста. */
  private readonly onFocus = (): void => {
    this.focusRun += 1
  }

  /** Ctrl+Z / Ctrl+Y в поле отменяют шаг документа, а не правку внутри поля. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return
    event.preventDefault()
    event.stopPropagation()
    if (key === 'y' || event.shiftKey) this.options.onRedo()
    else this.options.onUndo()
  }
}
