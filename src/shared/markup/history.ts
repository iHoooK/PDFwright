/**
 * История отмены вкладки: снимки «байты документа + несохранённая разметка».
 * Правка разметки не трогает байты, поэтому такой шаг хранит ссылку на те же
 * байты и почти ничего не стоит; операции со страницами дают новые байты.
 * Ограничиваем и общее число шагов, и число разных копий байтов в памяти.
 */

export interface Snapshot<Bytes, Markup> {
  bytes: Bytes
  markup: Markup
}

export interface HistoryLimits {
  /** Сколько шагов отмены хранить всего. */
  steps: number
  /** Сколько разных копий байтов документа держать в памяти. */
  byteCopies: number
}

export const HISTORY_LIMITS: HistoryLimits = { steps: 100, byteCopies: 12 }

export function distinctBytes<B, M>(history: readonly Snapshot<B, M>[]): number {
  return new Set(history.map((s) => s.bytes)).size
}

/**
 * Добавляет снимок в конец истории и отбрасывает самые старые шаги сверх лимитов.
 * Снимок может нести и другие поля вкладки (например, значения форм).
 */
export function pushSnapshot<S extends Snapshot<unknown, unknown>>(
  history: readonly S[],
  entry: S,
  limits: HistoryLimits = HISTORY_LIMITS
): S[] {
  const next = [...history, entry]
  while (next.length > limits.steps) next.shift()
  while (next.length > 1 && distinctBytes(next) > limits.byteCopies) next.shift()
  return next
}
