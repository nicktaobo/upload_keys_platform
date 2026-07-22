export interface ParsedKeyRow { apiKey: string; warrantyHours: number }
export interface KeyInputIssue { row: number; message: string }
export interface BatchAnalysis { totalRows: number; submitableRows: number; duplicateRows: number; invalidRows: number; rows: ParsedKeyRow[]; issues: KeyInputIssue[] }
export class KeyInputError extends Error {
  constructor(public readonly issues: KeyInputIssue[]) { super("Invalid Key input"); this.name = "KeyInputError"; }
}
export function parseBatch(input: string): ParsedKeyRow[] {
  const analysis = analyzeBatch(input);
  if (analysis.issues.length > 0) throw new KeyInputError(analysis.issues);
  return analysis.rows;
}
export function analyzeBatch(input: string): BatchAnalysis {
  const rows: ParsedKeyRow[] = [], issues: KeyInputIssue[] = [], seen = new Set<string>();
  let totalRows = 0, duplicateRows = 0;
  for (const [index, source] of input.split(/\r?\n/u).entries()) {
    const line = source.trim();
    if (!line) continue;
    totalRows += 1;
    const match = /^(\S+?)\s*(?:,\s*|\s+)(\S+)$/u.exec(line);
    const apiKey = match?.[1] ?? (/^[^,\s]+$/u.test(line) ? line : undefined);
    const warranty = match ? Number(match[2]) : 1;
    if (!apiKey) { issues.push({ row: index + 1, message: "每行必须包含一个 Key，可选填写质保期" }); continue; }
    if (!Number.isInteger(warranty) || warranty < 1 || warranty > 8760) { issues.push({ row: index + 1, message: "质保期必须是 1 到 8760 之间的整数" }); continue; }
    if (seen.has(apiKey)) { duplicateRows += 1; continue; }
    seen.add(apiKey); rows.push({ apiKey, warrantyHours: warranty });
  }
  return { totalRows, submitableRows: rows.length, duplicateRows, invalidRows: issues.length, rows, issues };
}
