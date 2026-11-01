const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today, 14:05" · "Yesterday, 09:12" · "12 Mar" · "12 Mar 2024" (locale-aware). */
export function formatModified(timestamp: number, now = Date.now()): string {
  const time = new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatDaysLeft(expiresAt: number, now = Date.now()): string {
  const days = Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
  return days <= 1 ? 'Deletes within a day' : `${days} days left`;
}
