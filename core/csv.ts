import fs from 'node:fs';
import crypto from 'node:crypto';

export function parseCSV(filePath: string): { headers: string[]; rows: string[][] } {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  const lines = text.split('\n');
  const parse = (line: string) =>
    line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g)?.map((v) => v.replace(/^"|"$/g, '').trim()) ?? [];
  const headers = parse(lines[0]);
  const rows = lines.slice(1).filter(Boolean).map(parse);
  return { headers, rows };
}

export function parseDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) {
    const [m, d, y] = raw.split('/');
    const fullYear = y.length === 2 ? (parseInt(y) < 50 ? `20${y}` : `19${y}`) : y;
    return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return raw;
}

export function parseCurrencyAmount(raw: string): number {
  const s = raw.trim();
  const negative = s.startsWith('(') && s.endsWith(')');
  const cleaned = s.replace(/[$,()]/g, '');
  const value = parseFloat(cleaned);
  return negative ? -value : value;
}

export function generateTxId(mask: string, date: string, name: string, amount: number): string {
  return 'csv-' + crypto.createHash('sha1')
    .update(`${mask}|${date}|${name.trim().toLowerCase()}|${amount}`)
    .digest('hex').slice(0, 16);
}
