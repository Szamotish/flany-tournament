const warsawDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function wallTime(date: Date): string {
  const parts = Object.fromEntries(warsawDateTime.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** A datetime-local field always represents Polish local time, independently of the server/browser timezone. */
export function parseTournamentDateTime(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return new Date(value);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return new Date(NaN);
  const desired = value.length === 16 ? `${value}:00` : value;
  const nominal = new Date(`${desired}Z`);
  if (!Number.isFinite(nominal.getTime()) || nominal.toISOString().slice(0, 19) !== desired) return new Date(NaN);

  // Probe both sides of a DST transition. Nonexistent spring times are rejected;
  // ambiguous autumn times resolve to their first occurrence.
  const offsets = [-86400000, 0, 86400000].map((shift) => {
    const probe = new Date(nominal.getTime() + shift);
    return Date.parse(`${wallTime(probe)}Z`) - probe.getTime();
  });
  const candidates = [...new Set(offsets)].map((offset) => new Date(nominal.getTime() - offset))
    .filter((date) => wallTime(date) === desired).sort((a, b) => a.getTime() - b.getTime());
  return candidates[0] ?? new Date(NaN);
}

export function tournamentDateTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? wallTime(date).slice(0, 16) : "";
}
