import type { FastifyBaseLogger } from 'fastify';
import { getDueSchedules, triggerSchedule } from './schedule.service.js';

/** Persistent unique (schedule, UTC minute) claims prevent duplicates across CP instances. */
export async function dispatchDueSchedules(now = new Date()): Promise<number> {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const schedules = await getDueSchedules(now);
  let dispatched = 0;
  const failures: Error[] = [];
  for (const schedule of schedules) {
    try {
      const result = await triggerSchedule(schedule.id, minute);
      if (result) dispatched += result.runIds.length;
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error('Schedule dispatch failed'));
    }
  }
  if (failures.length)
    throw new AggregateError(failures, `${failures.length} schedules failed to dispatch`);
  return dispatched;
}

export function startScheduleDispatcher(logger: FastifyBaseLogger): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const tick = async () => {
    try {
      const runs = await dispatchDueSchedules();
      if (runs) logger.info({ runs }, 'Scheduled runs dispatched');
    } catch {
      logger.error('Scheduled dispatch failed; will retry with the next poll');
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          pending = tick();
        }, 5_000);
    }
  };
  pending = tick();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await pending;
  };
}
