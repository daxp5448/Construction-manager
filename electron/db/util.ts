import crypto from 'crypto';
import { get, run, tx } from './core';
import { financialYear } from '../../src/shared/num';

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

/**
 * Next human-readable reference number.
 *  fy=true  -> "PO/26-27/0001" (resets every Indian financial year, Apr–Mar)
 *  fy=false -> "SUP-0001"
 */
export function nextNumber(prefix: string, opts: { date?: string; fy?: boolean; pad?: number } = {}): string {
  const { date, fy = true, pad = 4 } = opts;
  const fyLabel = fy ? financialYear(date || new Date().toISOString().slice(0, 10)) : '';
  const key = fy ? `${prefix}:${fyLabel}` : prefix;
  const n = tx(() => {
    const row = get<{ next_value: number }>('SELECT next_value FROM sequences WHERE key = ?', [key]);
    if (!row) {
      run('INSERT INTO sequences (key, next_value) VALUES (?, 2)', [key]);
      return 1;
    }
    run('UPDATE sequences SET next_value = next_value + 1 WHERE key = ?', [key]);
    return row.next_value;
  });
  const num = String(n).padStart(pad, '0');
  return fy ? `${prefix}/${fyLabel.slice(2)}/${num}` : `${prefix}-${num}`;
}

export function audit(
  entityType: string,
  entityId: string,
  action: string,
  data: { summary?: string; before?: unknown; after?: unknown; reason?: string | null } = {}
) {
  run(
    `INSERT INTO audit_logs (entity_type, entity_id, action, summary, before_json, after_json, reason)
     VALUES (?,?,?,?,?,?,?)`,
    [
      entityType,
      entityId,
      action,
      data.summary ?? null,
      data.before === undefined ? null : JSON.stringify(data.before),
      data.after === undefined ? null : JSON.stringify(data.after),
      data.reason ?? null,
    ]
  );
}

/** Human-readable diff of two flat rows, for audit summaries. */
export function diffSummary(before: Record<string, any> | null, after: Record<string, any>, skip: string[] = ['updated_at', 'created_at']): string {
  if (!before) return 'Created';
  const changes: string[] = [];
  for (const k of Object.keys(after)) {
    if (skip.includes(k)) continue;
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (a !== b) changes.push(`${k}: ${a === null ? '∅' : a} → ${b === null ? '∅' : b}`);
  }
  return changes.length ? changes.slice(0, 12).join('; ') + (changes.length > 12 ? '; …' : '') : 'No changes';
}
