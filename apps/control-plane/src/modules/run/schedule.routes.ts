/**
 * Schedule management routes.
 *
 * Endpoints for creating, listing, updating, and deleting schedule
 * configurations. Also supports manual triggering of scheduled runs.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import { authenticatedUser } from '../iam/auth.middleware.js';
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  isValidCronExpression,
  listSchedules,
  ScheduleTriggerError,
  triggerSchedule,
  updateSchedule,
} from './schedule.service.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateScheduleBodySchema = z.object({
  workspaceId: z.string().min(1).max(256),
  testSuiteId: z.string().min(1).max(256),
  cronExpression: z
    .string()
    .min(1)
    .max(128)
    .refine((val) => isValidCronExpression(val), {
      message:
        'Invalid cron expression. Expected 5 fields: minute hour day month weekday (e.g. "0 9 * * 1-5")',
    }),
  environmentId: z.string().min(1).max(256).optional(),
  enabled: z.boolean().optional(),
});

const UpdateScheduleBodySchema = z.object({
  cronExpression: z
    .string()
    .min(1)
    .max(128)
    .refine((val) => isValidCronExpression(val), {
      message:
        'Invalid cron expression. Expected 5 fields: minute hour day month weekday (e.g. "0 9 * * 1-5")',
    })
    .optional(),
  environmentId: z.string().min(1).max(256).nullable().optional(),
  enabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  /** Create a new schedule. */
  app.post('/api/schedules', async (request, reply) => {
    const parsed = CreateScheduleBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid schedule configuration', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const schedule = await createSchedule({
        workspaceId: parsed.data.workspaceId,
        testSuiteId: parsed.data.testSuiteId,
        cronExpression: parsed.data.cronExpression,
        environmentId: parsed.data.environmentId,
        enabled: parsed.data.enabled,
      });

      reply.status(201).send(schedule);
    } catch (error) {
      if (error instanceof ScheduleTriggerError) {
        return sendError(reply, 404, 'NOT_FOUND', error.message);
      }
      throw error;
    }
  });

  /** List schedules in the authenticated workspace. */
  app.get('/api/schedules', async (request, reply) => {
    const schedules = await listSchedules(authenticatedUser(request).workspaceId);
    reply.send({ schedules });
  });

  /** Get a single schedule. */
  app.get('/api/schedules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const schedule = await getSchedule(id);
    if (!schedule) {
      return sendError(reply, 404, 'NOT_FOUND', `Schedule ${id} not found`);
    }
    reply.send(schedule);
  });

  /** Update an existing schedule. */
  app.patch('/api/schedules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateScheduleBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid schedule updates', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    const schedule = await updateSchedule(id, parsed.data);
    if (!schedule) {
      return sendError(reply, 404, 'NOT_FOUND', `Schedule ${id} not found`);
    }

    reply.send(schedule);
  });

  /** Delete a schedule. */
  app.delete('/api/schedules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteSchedule(id);
    if (!deleted) {
      return sendError(reply, 404, 'NOT_FOUND', `Schedule ${id} not found`);
    }
    reply.status(204).send();
  });

  /** Manually trigger a scheduled run immediately. */
  app.post('/api/schedules/:id/trigger-now', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await triggerSchedule(id);
      if (!result) {
        return sendError(reply, 404, 'NOT_FOUND', `Schedule ${id} not found`);
      }
      reply.send({
        runId: result.runIds[0],
        runIds: result.runIds,
        testSuiteVersionId: result.testSuiteVersionId,
      });
    } catch (error) {
      if (error instanceof ScheduleTriggerError) {
        return sendError(reply, 422, 'INVALID_STATE', error.message);
      }
      request.log.error({ error }, 'Failed to trigger schedule');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to trigger schedule');
    }
  });
}
