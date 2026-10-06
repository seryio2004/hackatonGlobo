import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import type { ToolContext } from '../src/types';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-transfer-tests-'));
const port = await new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as net.AddressInfo).port;
    server.close(() => resolve(port));
  });
});
process.env.DATA_DIR = temp;
process.env.BANK_DATA_DIR = temp;
process.env.BANK_PORT = String(port);
process.env.BANK_URL = `http://127.0.0.1:${port}`;
process.env.BANK_TIMEOUT_MS = '100';
const { config } = await import('../src/config');
const { appDb, closeAppDb } = await import('../src/db');
const { transferMoney } = await import('../src/banking/actions');
const { POST, GET } = await import('../app/api/[...path]/route');
const { sessionToken } = await import('../src/auth');
const input = {
  fromAccountId: 'acc-lucia',
  toAccountId: 'acc-bruno',
  amountCents: 1000,
  concept: 'Test payment',
};
const ctx = (): ToolContext => ({
  userId: 'lucia',
  conversationId: null,
  runId: randomUUID(),
  intentId: randomUUID(),
});
let bank: ReturnType<typeof spawn>;
let bankOutput = '';
let seededOperationIds = new Set<string>();
const newOperations = (snapshot: any) =>
  snapshot.operations.filter((o: any) => !seededOperationIds.has(o.id));
async function admin(route: string, body?: unknown) {
  const response = await fetch(`${config.bankUrl}/admin/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${config.adminSecret}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.ok, true);
  return response.json();
}
async function reset(profile = 'normal') {
  await admin('reset', {});
  await admin('scenario', { profile, seed: 17 });
  seededOperationIds = new Set((await admin('snapshot')).operations.map((o: any) => o.id));
  appDb().exec('DELETE FROM approvals; DELETE FROM intents; DELETE FROM events;');
}
async function propose(context = ctx(), args = input) {
  const before = await admin('snapshot');
  const result = await transferMoney(context, args);
  assert.equal(result.status, 'requires_confirmation');
  assert.deepEqual(await admin('snapshot'), before);
  const approval = result.approval as { id: string; payload: typeof input };
  assert.deepEqual(approval.payload, args);
  return { ...context, approvalId: approval.id };
}
async function confirm(approvalId: string, userId = 'lucia') {
  return POST(
    new Request(`http://localhost/api/approvals/${approvalId}/confirm`, {
      method: 'POST',
      headers: { cookie: `banana_actor=${sessionToken(userId)}` },
    }),
    { params: Promise.resolve({ path: ['approvals', approvalId, 'confirm'] }) },
  );
}
before(async () => {
  bank = spawn(process.execPath, ['--import', 'tsx', 'simulator/server.ts'], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bank.stdout?.on('data', (s) => {
    bankOutput += s;
  });
  bank.stderr?.on('data', (s) => {
    bankOutput += s;
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (bank.exitCode !== null) throw new Error(bankOutput);
    try {
      if ((await fetch(`${config.bankUrl}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Bank did not start: ${bankOutput}`);
});
after(async () => {
  if (bank && bank.exitCode === null) {
    const stopped = once(bank, 'exit');
    bank.kill('SIGTERM');
    await stopped;
  }
  closeAppDb();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('actions only propose; repeated intent reuses the proposal; confirmation moves money once', async () => {
  await reset();
  const context = ctx();
  const response = await POST(
    new Request('http://localhost/api/actions', {
      method: 'POST',
      headers: {
        cookie: `banana_actor=${sessionToken('lucia')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'transfer_money',
        arguments: input,
        intentId: context.intentId,
      }),
    }),
    { params: Promise.resolve({ path: ['actions'] }) },
  );
  const proposal = await response.json();
  assert.equal(proposal.status, 'requires_confirmation');
  assert.equal(newOperations(await admin('snapshot')).length, 0);
  assert.equal(((await transferMoney(context, input)).approval as any).id, proposal.approval.id);
  const result = await (await confirm(proposal.approval.id)).json();
  assert.equal(result.status, 'completed');
  const snapshot = await admin('snapshot');
  const replay = await (await confirm(proposal.approval.id)).json();
  assert.equal(replay.operation.id, result.operation.id);
  assert.deepEqual(await admin('snapshot'), snapshot);
});

for (const profile of ['lost-response', 'slow-response', 'reject-before', 'intermittent']) {
  test(`${profile}: retries preserve one bank effect per intention`, async () => {
    await reset(profile);
    const count = profile === 'intermittent' ? 3 : 1;
    const initial = await admin('snapshot');
    for (let i = 0; i < count; i++) {
      const context = await propose();
      const result = await transferMoney(context, input);
      assert.equal(result.status, 'completed');
      const operation = result.operation as { reference: string };
      const intent = appDb()
        .prepare('SELECT bank_reference FROM intents WHERE id=?')
        .get(context.intentId) as any;
      assert.equal(intent.bank_reference, operation.reference);
      assert.equal((await transferMoney(context, input)).status, 'completed');
    }
    const snapshot = await admin('snapshot');
    assert.equal(newOperations(snapshot).length, count);
    const balance = (s: any, id: string) => s.accounts.find((a: any) => a.id === id).balanceCents;
    assert.equal(
      balance(snapshot, input.fromAccountId),
      balance(initial, input.fromAccountId) - count * input.amountCents,
    );
    assert.equal(
      balance(snapshot, input.toAccountId),
      balance(initial, input.toAccountId) + count * input.amountCents,
    );
  });
}

test('unavailable verification remains pending and original confirmation recovers it', async () => {
  await reset('read-unavailable');
  const context = await propose();
  const result = await transferMoney(context, input);
  assert.equal(result.status, 'pending');
  assert.equal(newOperations(await admin('snapshot')).length, 1);
  const dashboard = await GET(
    new Request('http://localhost/api/dashboard', {
      headers: { cookie: `banana_actor=${sessionToken('lucia')}` },
    }),
    { params: Promise.resolve({ path: ['dashboard'] }) },
  );
  const pending = (await dashboard.json()).pendingTransfers;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].approvalId, context.approvalId);
  closeAppDb(); // A new app DB connection must recover the durable reference and confirmation.
  const recovered = await (await confirm(context.approvalId)).json();
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.operation.reference, result.reference);
  assert.equal(newOperations(await admin('snapshot')).length, 1);
});

test('concurrent confirmations execute only one operation', async () => {
  await reset('slow-response');
  const context = await propose();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => confirm(context.approvalId).then((r) => r.json())),
  );
  assert.ok(results.every((r) => r.status === 'completed'));
  assert.equal(new Set(results.map((r) => r.operation?.id || r.operationId)).size, 1);
  assert.equal(newOperations(await admin('snapshot')).length, 1);
});

test('different legitimate intentions with identical details remain separate payments', async () => {
  await reset();
  const first = await propose();
  const second = await propose();
  await transferMoney(first, input);
  await transferMoney(second, input);
  const snapshot = await admin('snapshot');
  assert.equal(newOperations(snapshot).length, 2);
  assert.notEqual(newOperations(snapshot)[0].reference, newOperations(snapshot)[1].reference);
});

test('expired, foreign, and altered approvals cannot move money', async () => {
  await reset();
  const context = await propose();
  assert.equal((await confirm(context.approvalId, 'bruno')).status, 404);
  await assert.rejects(
    transferMoney(context, { ...input, amountCents: 2000 }),
    /different payload/,
  );
  const other = ctx();
  await propose(other);
  await assert.rejects(
    transferMoney({ ...other, approvalId: context.approvalId }, input),
    /does not authorize/,
  );
  appDb()
    .prepare('UPDATE approvals SET expires_at=? WHERE id=?')
    .run('2000-01-01T00:00:00.000Z', context.approvalId);
  assert.equal((await confirm(context.approvalId)).status, 409);
  assert.equal(newOperations(await admin('snapshot')).length, 0);
  const renewed = await propose({ ...context, approvalId: undefined });
  assert.notEqual(renewed.approvalId, context.approvalId);
  assert.equal((await transferMoney(renewed, input)).status, 'completed');
});

test('operators, foreign source accounts, and invalid amounts are rejected', async () => {
  await reset();
  await assert.rejects(transferMoney({ ...ctx(), userId: 'marta' }, input), /customer account/);
  await assert.rejects(transferMoney({ ...ctx(), userId: 'bruno' }, input), /does not belong/);
  for (const amountCents of [0, -1, 0.5, 10000001])
    await assert.rejects(transferMoney(ctx(), { ...input, amountCents }));
  await assert.rejects(
    transferMoney(ctx(), { ...input, toAccountId: input.fromAccountId }),
    /must differ/,
  );
  assert.equal(newOperations(await admin('snapshot')).length, 0);
});

test('insufficient funds are a verified failure with no effects', async () => {
  await reset();
  const args = { ...input, fromAccountId: 'acc-diego', amountCents: 10000 };
  const context = await propose({ ...ctx(), userId: 'diego' }, args);
  const before = await admin('snapshot');
  assert.equal((await transferMoney(context, args)).status, 'failed');
  assert.deepEqual(await admin('snapshot'), before);
});

test('unavailable status lookup never sends an unverified retry', async () => {
  await reset();
  const context = await propose();
  const originalFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/v1/operations/'))
      return Response.json({ error: 'Unavailable' }, { status: 503 });
    if (String(url).endsWith('/v1/transfers')) posts++;
    return originalFetch(url, options);
  };
  try {
    assert.equal((await transferMoney(context, input)).status, 'pending');
    assert.equal(posts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(newOperations(await admin('snapshot')).length, 0);
  assert.equal((await transferMoney(context, input)).status, 'completed');
  assert.equal(newOperations(await admin('snapshot')).length, 1);
});

test('malformed bank response after commit is reconciled without a second payment', async () => {
  await reset();
  const context = await propose();
  const originalFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (url, options) => {
    const response = await originalFetch(url, options);
    if (String(url).endsWith('/v1/transfers')) {
      posts++;
      assert.equal(response.ok, true);
      return new Response('invalid JSON', { status: 200 });
    }
    return response;
  };
  try {
    assert.equal((await transferMoney(context, input)).status, 'completed');
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(newOperations(await admin('snapshot')).length, 1);
});
