import { bankRequest, BankError } from './client';
import { appDb } from '../db';
import type { Operation, ToolContext, TransferInput } from '../types';
export class PendingTransferError extends Error {}
export async function dispatchTransfer(ctx: ToolContext, input: TransferInput): Promise<Operation> {
  const intent = appDb()
    .prepare('SELECT bank_reference FROM intents WHERE id=? AND user_id=?')
    .get(ctx.intentId, ctx.userId) as { bank_reference: string | null } | undefined;
  const reference = intent?.bank_reference;
  if (!reference) throw new Error('A confirmed transfer reference is required.');
  const lookup = async (): Promise<Operation | null> => {
    try {
      return await bankRequest<Operation>(
        ctx.userId,
        `/v1/operations/${encodeURIComponent(reference)}`,
      );
    } catch (e) {
      if (e instanceof BankError && e.status === 404) return null;
      throw new PendingTransferError(
        'The bank could not verify this transfer. Do not start another payment; check the original transfer again.',
      );
    }
  };
  const existing = await lookup();
  if (existing) return existing;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await bankRequest<Operation>(ctx.userId, '/v1/transfers', 'POST', {
        ...input,
        reference,
      });
    } catch (e) {
      if (!(e instanceof BankError) || e.status < 500) throw e;
      const operation = await lookup();
      if (operation) return operation;
      if (attempt === 1)
        throw new PendingTransferError(
          'The transfer is not yet verified. Check the original transfer again; do not create another payment.',
        );
      // The bank reported no operation. Any retry still uses the original key,
      // including when an earlier timed-out request is concurrently committing.
    }
  }
  throw new PendingTransferError('The transfer is not yet verified.');
}
