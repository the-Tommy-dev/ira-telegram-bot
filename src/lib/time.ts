export function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function parseClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function withinSendWindow(date: Date, timeZone: string, start: string, end: string) {
  const current = localMinutes(date, timeZone);
  const from = parseClock(start);
  const until = parseClock(end);
  return from <= until ? current >= from && current < until : current >= from || current < until;
}
