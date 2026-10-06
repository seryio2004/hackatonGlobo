import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { config } from '../config';
import type { Chunk, DocumentRecord } from '../types';
import { chunkDocument, htmlToText } from './chunker';
import { embedTexts, dimensions } from '../retrieval/embeddings';
import { replaceChunks, exportIndex } from '../retrieval/store';
export function documents(): DocumentRecord[] {
  return JSON.parse(fs.readFileSync(path.resolve('fixtures/documents/manifest.json'), 'utf8'));
}
function readDocumentSource(doc: DocumentRecord) {
  const root = path.resolve('fixtures/documents');
  const filename = path.resolve(root, doc.file);
  if (!filename.startsWith(root + path.sep)) throw new Error('Invalid document path.');
  return fs.readFileSync(filename, 'utf8').replace(/\r\n?/g, '\n');
}
export function readDocument(doc: DocumentRecord) {
  const text = readDocumentSource(doc);
  return path.extname(doc.file).toLowerCase() === '.html' ? htmlToText(text) : text;
}
export async function ingest(onProgress: (value: string) => void = () => {}) {
  const docs = documents();
  // Preserve source structure until the format-aware chunker has segmented it.
  const chunks: Chunk[] = docs.flatMap((doc) => chunkDocument(doc, readDocumentSource(doc)));
  onProgress(`${docs.length} documents · ${chunks.length} chunks`);
  const vectors = await embedTexts(chunks.map((c) => c.text));
  const complete = chunks.map((c, i) => ({ ...c, vector: vectors[i] }));
  replaceChunks(complete, { model: config.embeddingModel, dimensions });
  onProgress('Index updated.');
  return {
    documents: docs.length,
    chunks: complete.length,
    model: config.embeddingModel,
    dimensions,
  };
}
export function saveInitialIndex() {
  fs.mkdirSync('fixtures/embeddings', { recursive: true });
  fs.writeFileSync('fixtures/embeddings/index.json.gz', gzipSync(JSON.stringify(exportIndex())));
}
