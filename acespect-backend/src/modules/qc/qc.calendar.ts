/**
 * Business-day arithmetic for SLA clocks (REQ-SLA-004). A project's calendar is
 * its state's public holidays plus any extra dates an administrator adds, plus
 * optional industry shutdown periods (for example the Christmas builders'
 * shutdown). Holidays are computed, not looked up, so nothing needs loading
 * each year; state-specific one-offs (a royal event, a replaced holiday) are
 * added as extra dates in the project's policy.
 *
 * All dates are handled as Melbourne-local calendar days (YYYY-MM-DD) so a
 * 4pm Friday breach is not shifted by the server's UTC clock.
 */

export interface BusinessCalendar {
  state: string;
  /** Extra non-working dates, YYYY-MM-DD. */
  extraDates?: string[];
  /** Shutdown periods that count as non-working when the project enables them. */
  shutdowns?: Array<{ name: string; start: string; end: string }>;
  includeShutdowns?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const dow = (d: Date) => d.getUTCDay(); // 0 Sun .. 6 Sat

/** Gregorian Easter Sunday (anonymous algorithm). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** The nth (1-based) given weekday of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = utc(year, month, 1);
  const offset = (weekday - dow(first) + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

/** A fixed-date holiday that moves to the next Monday-ish weekday when it falls on a weekend ("additional day"). */
function substitute(d: Date, taken: Set<string>): Date {
  let x = d;
  while (dow(x) === 0 || dow(x) === 6 || taken.has(ymd(x))) x = addDays(x, 1);
  return x;
}

/** Public holidays for a state/territory in a year (YYYY-MM-DD set). */
export function publicHolidays(state: string, year: number): Set<string> {
  const st = state.toUpperCase();
  const out = new Set<string>();
  const add = (d: Date) => out.add(ymd(d));

  const easter = easterSunday(year);
  add(addDays(easter, -2)); // Good Friday
  add(addDays(easter, 1)); // Easter Monday
  add(addDays(easter, -1)); // Easter Saturday (a weekend day; listed for completeness)
  if (st === 'VIC' || st === 'NSW' || st === 'ACT' || st === 'QLD' || st === 'SA' || st === 'TAS') add(easter); // Easter Sunday

  // New Year's Day, Australia Day, Anzac Day, Christmas, Boxing Day with weekend substitution.
  const fixed: Date[] = [utc(year, 1, 1), utc(year, 1, 26), utc(year, 12, 25)];
  const taken = new Set<string>();
  for (const d of fixed) {
    const hol = dow(d) === 0 || dow(d) === 6 ? substitute(d, taken) : d;
    add(hol);
    taken.add(ymd(hol));
  }
  const boxing = utc(year, 12, 26);
  add(dow(boxing) === 0 || dow(boxing) === 6 ? substitute(boxing, taken) : boxing);
  const anzac = utc(year, 4, 25);
  // Anzac Day only moves in some states; it is a holiday on the day itself everywhere.
  add(anzac);
  if (dow(anzac) === 0 && (st === 'WA' || st === 'NT' || st === 'ACT')) add(addDays(anzac, 1));

  // King's Birthday: second Monday of June (WA: late September; QLD: first Monday of October).
  if (st === 'WA') add(nthWeekday(year, 9, 1, 4));
  else if (st === 'QLD') add(nthWeekday(year, 10, 1, 1));
  else add(nthWeekday(year, 6, 1, 2));

  // Labour Day.
  if (st === 'VIC') add(nthWeekday(year, 3, 1, 2));
  else if (st === 'WA') add(nthWeekday(year, 3, 1, 1));
  else if (st === 'ACT') add(nthWeekday(year, 3, 1, 2));
  else if (st === 'TAS') add(nthWeekday(year, 3, 1, 2));
  else if (st === 'NT' || st === 'QLD') add(nthWeekday(year, 5, 1, 1));
  else add(nthWeekday(year, 10, 1, 1)); // NSW, SA

  // Victoria: Friday before the AFL Grand Final (last Saturday of September, by convention) and Melbourne Cup Day.
  if (st === 'VIC') {
    const lastSat = (() => { let d = utc(year, 9, 30); while (dow(d) !== 6) d = addDays(d, -1); return d; })();
    add(addDays(lastSat, -1));
    add(nthWeekday(year, 11, 2, 1));
  }
  if (st === 'NSW' || st === 'ACT') add(nthWeekday(year, 8, 1, 1)); // Bank Holiday (NSW); Family & Community Day varies (ACT)
  return out;
}

function inShutdown(date: string, cal: BusinessCalendar): boolean {
  if (!cal.includeShutdowns) return false;
  return (cal.shutdowns ?? []).some((s) => date >= s.start && date <= s.end);
}

export function isBusinessDay(d: Date, cal: BusinessCalendar): boolean {
  const day = dow(d);
  if (day === 0 || day === 6) return false;
  const key = ymd(d);
  if (publicHolidays(cal.state, d.getUTCFullYear()).has(key)) return false;
  if (cal.extraDates?.includes(key)) return false;
  return !inShutdown(key, cal);
}

/** Melbourne wall-clock offset (hours) for a UTC instant: AEST +10 / AEDT +11 (DST first Sun Oct to first Sun Apr). */
export function melbourneOffsetHours(at: Date): number {
  const y = at.getUTCFullYear();
  const dstStart = addDays(nthWeekday(y, 10, 0, 1), 0); // first Sunday of October, 02:00 AEST
  const dstEnd = nthWeekday(y, 4, 0, 1); // first Sunday of April, 03:00 AEDT
  const startMs = dstStart.getTime() + (2 - 10) * 3_600_000;
  const endMs = dstEnd.getTime() + (3 - 11) * 3_600_000;
  const t = at.getTime();
  return t >= startMs || t < endMs ? 11 : 10;
}

/** The Melbourne-local calendar day of an instant, as a UTC-midnight Date. */
function localDay(at: Date): Date {
  const local = new Date(at.getTime() + melbourneOffsetHours(at) * 3_600_000);
  return utc(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate());
}

export function localYmd(at: Date): string {
  return ymd(localDay(at));
}

/**
 * Add business days: the clock starts at the same wall-clock time on the next
 * business day, so "1 business day" from Friday 3pm lands on Monday 3pm.
 */
export function addBusinessDays(from: Date, days: number, cal: BusinessCalendar): Date {
  let cursor = from;
  let left = days;
  while (left > 0) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    if (isBusinessDay(localDay(cursor), cal)) left -= 1;
  }
  return cursor;
}

/** Business days between two instants (the end day counts, the start day does not). */
export function businessDaysBetween(from: Date, to: Date, cal: BusinessCalendar): number {
  if (to <= from) return 0;
  let n = 0;
  let cursor = from;
  while (cursor < to) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    if (cursor > to && localYmd(cursor) !== localYmd(to)) break;
    if (isBusinessDay(localDay(cursor), cal)) n += 1;
  }
  return n;
}

export interface Duration {
  value: number;
  unit: 'hours' | 'business_days' | 'calendar_days';
}

export function addDuration(from: Date, d: Duration, cal: BusinessCalendar): Date {
  if (d.unit === 'hours') return new Date(from.getTime() + d.value * 3_600_000);
  if (d.unit === 'calendar_days') return new Date(from.getTime() + d.value * 86_400_000);
  return addBusinessDays(from, d.value, cal);
}
