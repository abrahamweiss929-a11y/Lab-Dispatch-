/**
 * Date + time formatting helpers used across the dispatcher UI.
 *
 * All functions accept an optional `timeZone` parameter (IANA name, e.g.
 * `"America/New_York"`). The default is `"UTC"` because the app has no
 * per-lab timezone setting yet — SPEC's "Timezones handled per-lab" is
 * future work, not this feature. When per-lab timezone lands, callers
 * will pass it in from the session/lab record and the default can stay
 * UTC as a safe floor.
 *
 * Formatting relies on `Intl.DateTimeFormat` with the `en-CA` locale for
 * ISO-shaped output (`en-CA` already produces `YYYY-MM-DD`). Time output
 * uses `en-US` for `"h:mm a"` and `"MMM d"` shapes.
 */

const UTC = "UTC";
const EN_US = "en-US";
const EN_CA = "en-CA";

export function todayIso(timeZone: string = UTC, now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat(EN_CA, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // `en-CA` formats as "YYYY-MM-DD".
  return formatter.format(now);
}

function parseIso(ts: string): Date | null {
  if (typeof ts !== "string" || ts.length === 0) return null;
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function formatShortDateTime(
  ts: string,
  timeZone: string = UTC,
): string {
  const date = parseIso(ts);
  if (date === null) return "—";
  const formatter = new Intl.DateTimeFormat(EN_US, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return formatter.format(date);
}

export function formatDateIsoToShort(dateIso: string): string {
  if (typeof dateIso !== "string" || dateIso.length === 0) return "—";
  // Parse as UTC noon to avoid timezone drift pulling the short date back
  // a day. We only render month/day, never a time, so the "noon" choice
  // is invisible — it just avoids `"2026-04-22"` → `"Apr 21"` in
  // negative-offset zones.
  const parsed = new Date(`${dateIso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "—";
  const formatter = new Intl.DateTimeFormat(EN_US, {
    timeZone: UTC,
    month: "short",
    day: "numeric",
  });
  return formatter.format(parsed);
}
