/**
 * Разбор дат PDF вида `D:YYYYMMDDHHmmSSOHH'mm'` (ISO 32000-1, 7.9.4).
 * Возвращает null для пустых и некорректных значений.
 */
export function parsePdfDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?$/.exec(
      value.trim()
    )
  if (!match) {
    const fallback = new Date(value)
    return Number.isNaN(fallback.getTime()) ? null : fallback
  }
  const [
    ,
    year,
    month = '01',
    day = '01',
    hour = '00',
    minute = '00',
    second = '00',
    sign,
    tzHour = '00',
    tzMinute = '00'
  ] = match
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )
  if (Number.isNaN(utc)) return null
  let offsetMinutes = 0
  if (sign === '+' || sign === '-') {
    offsetMinutes = (Number(tzHour) * 60 + Number(tzMinute)) * (sign === '+' ? 1 : -1)
  }
  const date = new Date(utc - offsetMinutes * 60_000)
  return Number.isNaN(date.getTime()) ? null : date
}
