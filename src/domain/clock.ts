export function assertIanaTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("Invalid IANA timezone");
  }
}

export function localDateAt(instant: Date, timezone: string): string {
  assertIanaTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function assertDateRange(startInclusive: string, endExclusive: string, requiredDays: number): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startInclusive) || !/^\d{4}-\d{2}-\d{2}$/.test(endExclusive)) {
    throw new Error("Dates must use YYYY-MM-DD");
  }
  const start = Date.parse(`${startInclusive}T00:00:00Z`);
  const end = Date.parse(`${endExclusive}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Invalid calendar date");
  if (new Date(start).toISOString().slice(0, 10) !== startInclusive || new Date(end).toISOString().slice(0, 10) !== endExclusive) {
    throw new Error("Invalid calendar date");
  }
  if (end <= start) throw new Error("End date must follow start date");
  const days = Math.round((end - start) / 86_400_000);
  if (!Number.isInteger(requiredDays) || requiredDays < 1 || requiredDays > days) throw new Error("Required days exceed goal period");
}

export function dateWithin(date: string, startInclusive: string, endExclusive: string): boolean {
  return date >= startInclusive && date < endExclusive;
}
