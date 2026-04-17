/**
 * RFC 3339 `date` / `time` / `date-time` / `duration` format validators.
 *
 * @packageDocumentation
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const DURATION_RE = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(?:\.\d+)?S)?)?$/;

function isValidMonthDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * RFC 3339 `full-date` (e.g. `"2024-01-31"`).
 *
 * @public
 */
export function validateDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number.parseInt(match[1] ?? "0", 10);
  const month = Number.parseInt(match[2] ?? "0", 10);
  const day = Number.parseInt(match[3] ?? "0", 10);
  return isValidMonthDay(year, month, day);
}

/**
 * RFC 3339 `full-time` (e.g. `"12:34:56Z"` or `"12:34:56+02:00"`).
 *
 * @public
 */
export function validateTime(value: string): boolean {
  const match = TIME_RE.exec(value);
  if (!match) return false;
  const hour = Number.parseInt(match[1] ?? "0", 10);
  const minute = Number.parseInt(match[2] ?? "0", 10);
  const second = Number.parseInt(match[3] ?? "0", 10);
  if (hour > 23) return false;
  if (minute > 59) return false;
  // allow leap second 60 at any minute for v1 simplicity
  if (second > 60) return false;
  return true;
}

/**
 * RFC 3339 `date-time` (e.g. `"2024-01-31T12:34:56Z"`).
 *
 * @public
 */
export function validateDateTime(value: string): boolean {
  const match = DATE_TIME_RE.exec(value);
  if (!match) return false;
  const year = Number.parseInt(match[1] ?? "0", 10);
  const month = Number.parseInt(match[2] ?? "0", 10);
  const day = Number.parseInt(match[3] ?? "0", 10);
  const hour = Number.parseInt(match[4] ?? "0", 10);
  const minute = Number.parseInt(match[5] ?? "0", 10);
  const second = Number.parseInt(match[6] ?? "0", 10);
  if (!isValidMonthDay(year, month, day)) return false;
  if (hour > 23 || minute > 59 || second > 60) return false;
  return true;
}

/**
 * ISO 8601 `duration` (e.g. `"P1Y2M10DT2H30M"`).
 *
 * @public
 */
export function validateDuration(value: string): boolean {
  return DURATION_RE.test(value);
}
