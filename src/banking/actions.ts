import { z } from 'zod';
import { appDb } from '../db';
import { HttpError } from '../auth';
import { person } from '../people';
import { authorizeTransfer } from './authorization';
import { dispatchTransfer, PendingTransferError } from './dispatch';
import { bankRequest } from './client';
import { recordEvent } from '../telemetry';
import type { ActionResult, Operation, ToolContext } from '../types';
export const transferSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amountCents: z.number().int().positive().max(10000000),
    concept: z.string().max(200),
  })
  .strict();
export async function transferMoney(ctx: ToolContext, args: unknown): Promise<ActionResult> {
  if (person(ctx.userId)?.role !== 'customer')
    throw new HttpError(403, 'A customer account is required.');
  const input = transferSchema.parse(args),
    db = appDb();
  const previous = db.prepare('SELECT * FROM intents WHERE id=?').get(ctx.intentId) as
    | {
        user_id: string;
        payload: string;
        status: string;
        bank_reference: string | null;
        operation_id: string | null;
      }
    | undefined;
  if (previous && (previous.user_id !== ctx.userId || previous.payload !== JSON.stringify(input)))
    throw new HttpError(409, 'This intent belongs to a different payload.');
  if (previous?.status === 'completed') {
    let operation: Operation | undefined;
    try {
      operation = await bankRequest<Operation>(
        ctx.userId,
        `/v1/operations/${encodeURIComponent(previous.bank_reference!)}`,
      );
    } catch {
      /* Completion was already verified and persisted. Never resend. */
    }
    return {
      status: 'completed',
      operation,
      operationId: previous.operation_id,
      reference: previous.bank_reference,
      intentId: ctx.intentId,
    };
  }
  db.prepare('INSERT OR IGNORE INTO intents VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    ctx.intentId,
    ctx.userId,
    ctx.conversationId,
    ctx.runId,
    JSON.stringify(input),
    'created',
    null,
    null,
    null,
    new Date().toISOString(),
  );
  const permission = await authorizeTransfer(ctx, input);
  if (permission) return permission;
  db.prepare("UPDATE intents SET status=? WHERE id=? AND status!='completed'").run(
    'processing',
    ctx.intentId,
  );
  recordEvent(ctx, 'transfer.started', { status: 'processing', input, intentId: ctx.intentId });
  try {
    const operation = await dispatchTransfer(ctx, input);
    db.prepare('UPDATE intents SET status=?,operation_id=?,error=NULL WHERE id=?').run(
      'completed',
      operation.id,
      ctx.intentId,
    );
    recordEvent(ctx, 'transfer.completed', {
      status: 'completed',
      operation,
      intentId: ctx.intentId,
    });
    return { status: 'completed', operation, intentId: ctx.intentId };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Transfer error';
    const status = e instanceof PendingTransferError ? 'pending' : 'failed';
    db.prepare("UPDATE intents SET status=?,error=? WHERE id=? AND status!='completed'").run(
      status,
      message,
      ctx.intentId,
    );
    const current = db
      .prepare('SELECT status,operation_id,bank_reference FROM intents WHERE id=?')
      .get(ctx.intentId) as { status: string; operation_id: string | null; bank_reference: string };
    if (current.status === 'completed')
      return {
        status: 'completed',
        operationId: current.operation_id,
        reference: current.bank_reference,
        intentId: ctx.intentId,
      };
    recordEvent(ctx, `transfer.${status}`, {
      status,
      error: message,
      intentId: ctx.intentId,
    });
    return { status, error: message, reference: current.bank_reference, intentId: ctx.intentId };
  }
}
