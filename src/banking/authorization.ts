import { randomUUID } from 'node:crypto';
import { bankRequest } from './client';
import { appDb } from '../db';
import { HttpError } from '../auth';
import type { Account, ActionResult, ToolContext, TransferInput } from '../types';
type Approval = {
  id: string;
  user_id: string;
  intent_id: string;
  payload: string;
  expires_at: string;
  consumed_at: string | null;
};
export async function authorizeTransfer(
  ctx: ToolContext,
  input: TransferInput,
): Promise<ActionResult | null> {
  const accounts = await bankRequest<Account[]>(ctx.userId, '/v1/accounts');
  if (!accounts.some((a) => a.id === input.fromAccountId))
    throw new HttpError(403, 'This account does not belong to this person.');
  if (input.fromAccountId === input.toAccountId)
    throw new HttpError(400, 'Source and destination must differ.');
  const db = appDb();
  // No await inside this transaction: approval consumption and the stable reference
  // become durable together, before any request capable of moving money.
  return db.transaction((): ActionResult | null => {
    const now = new Date().toISOString();
    const payload = JSON.stringify(input);
    if (!ctx.approvalId) {
      const confirmed = db
        .prepare(
          'SELECT id FROM approvals WHERE intent_id=? AND user_id=? AND consumed_at IS NOT NULL',
        )
        .get(ctx.intentId, ctx.userId);
      if (confirmed)
        return {
          status: 'pending',
          intentId: ctx.intentId,
          error:
            'This transfer was already confirmed. Check its status using the original proposal.',
        };
      let approval = db
        .prepare(
          'SELECT * FROM approvals WHERE intent_id=? AND user_id=? AND consumed_at IS NULL AND expires_at>?',
        )
        .get(ctx.intentId, ctx.userId, now) as Approval | undefined;
      if (!approval) {
        approval = {
          id: randomUUID(),
          user_id: ctx.userId,
          intent_id: ctx.intentId,
          payload,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          consumed_at: null,
        };
        db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?)').run(
          approval.id,
          approval.user_id,
          approval.intent_id,
          payload,
          approval.expires_at,
          null,
        );
      }
      db.prepare('UPDATE intents SET status=? WHERE id=?').run(
        'requires_confirmation',
        ctx.intentId,
      );
      return {
        status: 'requires_confirmation',
        intentId: ctx.intentId,
        approval: { id: approval.id, payload: input, expiresAt: approval.expires_at },
      };
    }
    const approval = db.prepare('SELECT * FROM approvals WHERE id=?').get(ctx.approvalId) as
      Approval | undefined;
    if (
      !approval ||
      approval.user_id !== ctx.userId ||
      approval.intent_id !== ctx.intentId ||
      approval.payload !== payload
    )
      throw new HttpError(403, 'This proposal does not authorize these transfer details.');
    const intent = db
      .prepare('SELECT bank_reference FROM intents WHERE id=?')
      .get(ctx.intentId) as { bank_reference: string | null };
    if (approval.consumed_at) {
      if (!intent.bank_reference)
        throw new HttpError(409, 'This proposal has already been consumed.');
      return null; // Resume the same confirmed intent, never create another reference.
    }
    if (approval.expires_at <= now)
      throw new HttpError(409, 'This proposal has expired. Request a new proposal.');
    db.prepare('UPDATE approvals SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(
      now,
      approval.id,
    );
    db.prepare(
      'UPDATE intents SET bank_reference=COALESCE(bank_reference,?),status=? WHERE id=?',
    ).run(randomUUID(), 'confirmed', ctx.intentId);
    return null;
  })();
}
