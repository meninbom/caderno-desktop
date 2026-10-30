import { localDateTimeInZone, zonedLocalToEpoch } from './zoned-time';

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type Priority = 'low' | 'normal' | 'high';

/** Advance civil dates, preserving the original monthly day and local clock. */
export function nextOccurrence(rule: Exclude<Recurrence, 'none'>, anchor: string, dueAt: number, now: number, zone: string): number {
  const date = new Date(`${anchor}:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('Data de recorrência inválida.');
  const boundary = Math.max(dueAt, now);
  const localBoundary = new Date(`${localDateTimeInZone(boundary, zone)}:00Z`);
  let step = rule === 'monthly'
    ? Math.max(1, (localBoundary.getUTCFullYear() - date.getUTCFullYear()) * 12 + localBoundary.getUTCMonth() - date.getUTCMonth())
    : Math.max(1, Math.floor((localBoundary.getTime() - date.getTime()) / (86400000 * (rule === 'weekly' ? 7 : 1))));
  for (let attempt = 0; attempt < 4; attempt++, step++) {
    const candidate = new Date(date);
    if (rule === 'monthly') {
      candidate.setUTCDate(1);
      candidate.setUTCMonth(candidate.getUTCMonth() + step);
      const last = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
      candidate.setUTCDate(Math.min(date.getUTCDate(), last));
    } else candidate.setUTCDate(candidate.getUTCDate() + step * (rule === 'weekly' ? 7 : 1));
    // A skipped DST hour moves to the first valid local minute on that day.
    for (let minute = 0; minute <= 180; minute++) {
      try {
        const value = zonedLocalToEpoch(candidate.toISOString().slice(0, 16), zone);
        if (value > boundary) return value;
        break;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('não existe')) throw error;
        candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
      }
    }
  }
  throw new Error('Não foi possível calcular a próxima ocorrência.');
}
