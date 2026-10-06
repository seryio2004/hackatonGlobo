import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DocumentRecord } from '../src/types';
import { chunkDocument, htmlToText } from '../src/ingestion/chunker';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-ingestion-'));
process.env.DATA_DIR = temp;
const { documents, readDocument, ingest } = await import('../src/ingestion/pipeline');
const { appDb, closeAppDb } = await import('../src/db');
const { allChunks } = await import('../src/retrieval/store');
const { embeddingKey, vectorBuffer, dimensions } = await import('../src/retrieval/embeddings');

const doc: DocumentRecord = {
  id: 'test-policy',
  title: 'Test policy',
  file: 'test-policy.md',
  version: 2,
  validFrom: '2026-09-01',
  validTo: '2026-09-30',
  audience: 'internal',
  family: 'test',
};
const corpus = documents();
function source(record: DocumentRecord): string {
  return fs.readFileSync(path.resolve('fixtures/documents', record.file), 'utf8');
}

test('every corpus chunk retains document metadata and reproducible, unique source IDs', () => {
  const ids: string[] = [];
  for (const record of corpus) {
    const chunks = chunkDocument(record, source(record));
    assert.ok(chunks.length > 1, record.id);
    assert.deepEqual(chunkDocument(record, source(record)), chunks);
    for (const chunk of chunks) {
      for (const key of ['title', 'version', 'validFrom', 'validTo', 'audience'] as const)
        assert.equal(chunk[key], record[key], `${record.id}: ${key}`);
      assert.equal(chunk.documentId, record.id);
      assert.ok(chunk.text.trim());
      ids.push(chunk.id);
    }
  }
  assert.equal(new Set(ids).size, ids.length);
});

test('Markdown keeps long policy sections intact and overlaps adjacent exceptions', () => {
  const rule = `The monthly fee is EUR 6. ${'Policy context. '.repeat(100)}`.trim();
  const exception = 'Waived only with salary EUR 1,200 AND three settled purchases.';
  const text = `# Aurora\n\n## Fee\n\n${rule}\n\n### Exceptions\n\n${exception}\n\n## Support\n\nAsk an operator.`;
  const chunks = chunkDocument(doc, text);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.some((c) => c.text.includes(rule) && c.text.includes(exception)));
  assert.ok(chunks.every((c) => c.text.includes('# Aurora')));
  assert.match(chunks[1].text, /## Fee[\s\S]*### Exceptions/);
  assert.equal(chunks[0].validTo, doc.validTo);
});

test('Markdown code fences do not create false sections', () => {
  const text =
    '# Policy\n\n## Example\n\n```md\n## Not a heading\n```\n\nException applies.\n\n## Next\n\nNext section.';
  const chunks = chunkDocument(doc, text);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].text.includes('```md\n## Not a heading\n```\n\nException applies.'));
});

test('HTML respects structural sections, lists and entities while omitting scripts and styles', () => {
  const html =
    '<style>hidden style</style><script>hidden script</script>' +
    '<section><h1>Aurora</h1><p>Fee: &euro;6 &amp; conditions.</p></section>' +
    '<section><h2>Exceptions</h2><ul><li>Salary &#8364;1,200</li><li>Three settled purchases</li></ul></section>' +
    '<section><h2>Support</h2><p>Keep &lt;reference&gt;.</p></section>';
  const chunks = chunkDocument({ ...doc, file: 'policy.html' }, html);
  assert.equal(chunks.length, 3);
  assert.ok(
    chunks.some(
      (c) =>
        /Fee: €6 & conditions\./.test(c.text) &&
        c.text.includes('- Salary €1,200') &&
        c.text.includes('- Three settled purchases'),
    ),
  );
  assert.ok(chunks.every((c) => !/hidden|<section|<li/.test(c.text)));
  assert.match(htmlToText(html), /Keep <reference>\./);
  assert.match(
    readDocument(corpus.find((d) => d.id === 'aurora-operations-2026')!),
    /## Terms and exceptions\n\nThe Aurora/,
  );
});

test('CSV keeps complete rows with field names, multiline values, commas and escaped quotes', () => {
  const csv =
    '\uFEFFproduct,rule,exception\r\n"Aurora","Fee EUR 6, monthly","Salary EUR 1,200\r\nand three purchases; say ""both"""\r\n"Cloud","Fee EUR 0",""\r\n';
  const chunks = chunkDocument({ ...doc, file: 'policy.csv' }, csv);
  assert.equal(chunks.length, 2);
  assert.equal(
    chunks[0].text,
    'product: Aurora\nrule: Fee EUR 6, monthly\nexception: Salary EUR 1,200\nand three purchases; say "both"',
  );
  assert.equal(chunks[1].text, 'product: Cloud\nrule: Fee EUR 0\nexception:');
  assert.ok(!chunks[0].text.includes('Cloud'));
});

test('HTML container boundaries work without headings and long CSV records stay intact', () => {
  const html =
    '<section><p>Monthly fee EUR 6.</p></section>' +
    '<section><p>Exception: salary EUR 1,200 and three purchases.</p></section>';
  const chunks = chunkDocument({ ...doc, file: 'policy.html' }, html);
  assert.equal(chunks.length, 2);
  assert.match(
    chunks[1].text,
    /Monthly fee EUR 6\.[\s\S]*Exception: salary EUR 1,200 and three purchases/,
  );
  const rule = 'Monthly fee EUR 6. ' + 'Policy context. '.repeat(100);
  const exception = 'Salary EUR 1,200 and three settled purchases.';
  const records = chunkDocument(
    { ...doc, file: 'policy.csv' },
    `rule,exception\n"${rule}","${exception}"`,
  );
  assert.equal(records.length, 1);
  assert.ok(records[0].text.includes(rule));
  assert.ok(records[0].text.includes(exception));
});

test('malformed CSV fails rather than silently losing policy fields', () => {
  const csvDoc = { ...doc, file: 'policy.csv' };
  assert.throws(() => chunkDocument(csvDoc, 'rule,exception\n"unterminated'), /Unterminated/);
  assert.throws(() => chunkDocument(csvDoc, 'rule,exception\nfee'), /headers/);
});

test('Aurora waiver retains minimum salary AND three purchases in Markdown, HTML and CSV', () => {
  for (const id of [
    'aurora-fees-2026',
    'aurora-operations-2026',
    'notice-aurora',
    'faq-aurora-waiver',
  ]) {
    const record = corpus.find((d) => d.id === id)!;
    const chunks = chunkDocument(record, source(record));
    const rules = chunks.filter((c) => c.text.includes('1,200'));
    assert.ok(rules.length, id);
    for (const chunk of rules) {
      assert.match(chunk.text, /three settled (?:card )?(?:purchases|purchase)/, id);
      assert.match(chunk.text, /(?:EUR 6|EUR 0)/, id);
    }
    if (id === 'aurora-fees-2026' || id === 'aurora-operations-2026') {
      for (const chunk of rules) {
        assert.match(chunk.text, /If either requirement is missing, the fee is EUR 6/);
        assert.match(chunk.text, /own account does not count as a salary payment/);
      }
    }
  }
});

test('empty documents produce no chunks and identical repeated sections keep distinct IDs', () => {
  assert.deepEqual(chunkDocument(doc, ' \n\n '), []);
  assert.deepEqual(chunkDocument({ ...doc, file: 'policy.csv' }, 'rule,exception\n'), []);
  const chunks = chunkDocument(doc, '## Rule\nSame.\n## Rule\nSame.\n## Rule\nSame.');
  assert.equal(new Set(chunks.map((c) => c.id)).size, 3);
  assert.notEqual(
    chunkDocument({ ...doc, id: 'other-source' }, 'Policy.')[0].id,
    chunkDocument(doc, 'Policy.')[0].id,
  );
  assert.deepEqual(
    chunkDocument(doc, '# Title\r\n\r\nPolicy.'),
    chunkDocument(doc, '# Title\n\nPolicy.'),
  );
});

test('ingestion persists format-aware chunks and metadata using cached test vectors without API calls', async () => {
  const chunks = corpus.flatMap((record) => chunkDocument(record, source(record)));
  const vector = Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0));
  const db = appDb();
  db.transaction(() => {
    const insert = db.prepare('INSERT OR REPLACE INTO embedding_cache VALUES(?,?)');
    for (const chunk of chunks) insert.run(embeddingKey(chunk.text), vectorBuffer(vector));
  })();
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = ' ';
  try {
    const result = await ingest();
    assert.equal(result.documents, 80);
    assert.equal(result.chunks, chunks.length);
    const expected = chunks.map((c) => ({ ...c, vector })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(allChunks(), expected);
    await ingest();
    assert.deepEqual(allChunks(), expected);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

after(() => {
  closeAppDb();
  fs.rmSync(temp, { recursive: true, force: true });
});
