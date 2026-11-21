import React from 'react';
import { Inbox } from 'lucide-react';
import { cx, EmptyState, ErrorState, TableSkeleton } from './base';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T, index: number) => React.ReactNode;
  align?: 'l' | 'r';
  width?: number | string;
  muted?: boolean;
  mono?: boolean;
  /** footer cell (totals) */
  total?: (rows: T[]) => React.ReactNode;
  /** allow the text to wrap onto several lines (default: single line with ellipsis) */
  wrap?: boolean;
  nowrap?: boolean;
}

export function DataTable<T extends Record<string, any>>({
  rows,
  columns,
  rowKey = (r: T) => r.id,
  onRowClick,
  loading,
  error,
  onRetry,
  empty,
  selectedId,
  maxHeight,
  rowClass,
  groupBy,
}: {
  rows: T[] | null;
  columns: Column<T>[];
  rowKey?: (r: T) => string;
  onRowClick?: (r: T) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: React.ReactNode;
  selectedId?: string | null;
  maxHeight?: number | string;
  rowClass?: (r: T) => string | undefined;
  /** render a group heading row whenever this returns a new value */
  groupBy?: (r: T) => string | null;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (rows === null && loading) return <TableSkeleton cols={Math.min(columns.length, 6)} />;
  const data = rows ?? [];
  if (!data.length && !loading) {
    return (
      <div className="card">
        {empty ?? <EmptyState icon={<Inbox size={22} />} title="Nothing here yet" />}
      </div>
    );
  }
  const hasTotals = columns.some((c) => c.total);
  let lastGroup: string | null | undefined;
  return (
    <div className="tbl-wrap" style={{ maxHeight, opacity: loading ? 0.65 : 1, transition: 'opacity .15s' }}>
      <table className="tbl" data-selectable>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'r' ? 'r' : undefined} style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => {
            const g = groupBy ? groupBy(r) : null;
            const groupRow =
              groupBy && g !== lastGroup ? (
                <tr key={`g-${g}-${i}`} className="group-row">
                  <td colSpan={columns.length}>{g}</td>
                </tr>
              ) : null;
            lastGroup = g;
            const k = rowKey(r);
            return (
              <React.Fragment key={k}>
                {groupRow}
                <tr className={cx(onRowClick && 'click', selectedId === k && 'sel', rowClass?.(r))} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                  {columns.map((c) => (
                    <TableCell key={c.key} col={c} row={r} index={i} />
                  ))}
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr>
              {columns.map((c, i) => (
                <td key={c.key} className={cx(c.align === 'r' && 'r num')}>
                  {c.total ? c.total(data) : i === 0 ? 'Total' : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function TableCell<T extends Record<string, any>>({ col, row, index }: { col: Column<T>; row: T; index: number }) {
  const content = col.render ? col.render(row, index) : ((row[col.key] as React.ReactNode) ?? '');
  const plain = typeof content === 'string' ? content : undefined;
  return (
    <td
      className={cx(col.align === 'r' && 'r num', col.muted && 'muted', col.mono && 'mono')}
      title={plain && plain.length > 28 ? plain : undefined}
      style={col.wrap ? { minWidth: 160 } : { whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      {content}
    </td>
  );
}
