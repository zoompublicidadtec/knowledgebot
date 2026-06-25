export function localToUtc(localDateStr: string, timeZone: string): Date {
  // We want to treat localDateStr as a "wall clock time" in the given timezone
  // and convert it to a real UTC Date.
  //
  // Strategy:
  // 1. Parse the date string as if it were UTC to get the year/month/day/hour/minute/second components.
  // 2. Use Intl to find what UTC offset applies to that local time in the given timezone.
  // 3. Subtract the offset to get the real UTC instant.
  //
  // Example: localDateStr = "2026-06-03T09:00:00", timeZone = "America/Bogota" (UTC-5)
  // → result should be new Date("2026-06-03T14:00:00.000Z")

  // Parse components directly from the string (avoids any UTC/local browser interpretation)
  const match = localDateStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return new Date(localDateStr);

  const [, year, month, day, hour, minute, second] = match.map(Number);

  // Build a UTC timestamp treating the local components as UTC (a "naive" datetime)
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  // Now find what this UTC instant looks like in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const formatted = formatter.format(new Date(naiveUtcMs));
  const tzMatch = formatted.match(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/);
  if (!tzMatch) return new Date(localDateStr);

  const [, tzMonth, tzDay, tzYear, tzHour, tzMinute, tzSecond] = tzMatch.map(Number);
  const tzInterpretedMs = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, tzSecond);

  // offset = naiveUtcMs - tzInterpretedMs
  const offsetMs = naiveUtcMs - tzInterpretedMs;

  // The real UTC time = naiveUtcMs + offsetMs
  return new Date(naiveUtcMs + offsetMs);
}

export function getDateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const formatted = formatter.format(date);
  const match = formatted.match(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/);
  if (!match) {
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  return {
    year: Number(match[3]),
    month: Number(match[1]) - 1,
    day: Number(match[2]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}
