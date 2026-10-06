import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Chunk, DocumentRecord } from '../types';

// Keep sections atomic: a character limit must not separate a rule from its
// qualifications. The corpus has short sections; adjacent sections overlap to
// retain exceptions that are published under a separate heading.
function markdownSections(text: string): string[] {
  const sections: string[] = [];
  const headings: { level: number; text: string }[] = [];
  let lines: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    const body = lines.join('\n').trim();
    if (body) sections.push([...headings.map((h) => h.text), body].join('\n\n'));
    lines = [];
  };
  for (const line of text.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      lines.push(line);
      continue;
    }
    const heading = !fence && line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, text: line.trim() });
    } else lines.push(line);
  }
  flush();
  if (!sections.length && headings.length) sections.push(headings.map((h) => h.text).join('\n\n'));
  return sections;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    euro: '€',
  };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, value: string) => {
    if (value.startsWith('#')) {
      const code =
        value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    }
    return named[value.toLowerCase()] ?? entity;
  });
}

function htmlText(text: string, structuralBreaks: boolean): string {
  return decodeEntities(
    text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n\n${'#'.repeat(Number(level))} `)
      .replace(/<\/h[1-6]\s*>/gi, '\n\n')
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(?:td|th)\s*>/gi, ' | ')
      .replace(/<\/(?:section|article|div)\s*>/gi, structuralBreaks ? '\n\u001e\n' : '\n\n')
      .replace(/<\/?(?:p|section|article|div|ul|ol|table|tr)\b[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Used by the document API as well as ingestion, without exposing markup.
export function htmlToText(text: string): string {
  return htmlText(text, false);
}

function csvSections(text: string): string[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || !field.length) quoted = !quoted;
      else field += char;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field);
      field = '';
      if (char === '\n') {
        rows.push(row);
        row = [];
      }
    } else field += char;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field.');
  if (field.length || row.length) rows.push([...row, field]);
  const headers = rows.shift() ?? [];
  return rows
    .filter((r) => r.some((value) => value.trim()))
    .map((values) => {
      if (values.length !== headers.length) throw new Error('CSV row does not match its headers.');
      return values
        .map((value, i) => `${headers[i].trim()}: ${value}`)
        .join('\n')
        .trim();
    });
}

export function chunkDocument(doc: DocumentRecord, text: string): Chunk[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const format = path.extname(doc.file).toLowerCase();
  const sections =
    format === '.csv'
      ? csvSections(normalized)
      : format === '.html'
        ? htmlText(normalized, true).split('\u001e').flatMap(markdownSections)
        : markdownSections(normalized);
  return sections.map((section, index) => {
    // CSV records are self-contained and keep their field names in each chunk.
    const part = format !== '.csv' && index > 0 ? `${sections[index - 1]}\n\n${section}` : section;
    return {
      id: createHash('sha256').update(`${doc.id}:${index}:${part}`).digest('hex').slice(0, 24),
      documentId: doc.id,
      text: part,
      title: doc.title,
      version: doc.version,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      audience: doc.audience,
    };
  });
}
