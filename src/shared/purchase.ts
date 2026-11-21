import { mulQtyRate, pctOf, sum, taxInside } from './num';

export type TaxTreatment = 'exclusive' | 'inclusive' | 'exempt';

export interface LineInput {
  qty_milli: number;
  rate_paise: number;
  tax_bp: number;
}
export interface LineResult {
  subtotal_paise: number;
  tax_paise: number;
  total_paise: number;
}

/**
 * Line maths (all integers):
 *   exclusive: Subtotal = Qty x Rate;  Tax = Subtotal x Tax% / 100;  Line total = Subtotal + Tax
 *   inclusive: Gross = Qty x Rate (tax is already inside the rate); Tax = Gross x t / (100 + t); Subtotal = Gross - Tax
 *   exempt:    Tax = 0
 */
export function computeLine(treatment: TaxTreatment, l: LineInput): LineResult {
  const gross = mulQtyRate(l.qty_milli || 0, l.rate_paise || 0);
  if (treatment === 'exempt') return { subtotal_paise: gross, tax_paise: 0, total_paise: gross };
  if (treatment === 'inclusive') {
    const tax = taxInside(gross, l.tax_bp || 0);
    return { subtotal_paise: gross - tax, tax_paise: tax, total_paise: gross };
  }
  const tax = pctOf(gross, l.tax_bp || 0);
  return { subtotal_paise: gross, tax_paise: tax, total_paise: gross + tax };
}

export interface Totals {
  subtotal_paise: number;
  tax_paise: number;
  total_paise: number;
}

/** Grand Total = Subtotal + Tax + Freight + Other charges (+/- manual adjustment) */
export function computeTotals(
  treatment: TaxTreatment,
  lines: LineInput[],
  extra: { freight_paise?: number; other_charges_paise?: number; adjustment_paise?: number } = {}
): Totals & { lines: LineResult[] } {
  const results = lines.map((l) => computeLine(treatment, l));
  const subtotal = sum(results.map((r) => r.subtotal_paise));
  const tax = sum(results.map((r) => r.tax_paise));
  const total = subtotal + tax + (extra.freight_paise || 0) + (extra.other_charges_paise || 0) + (extra.adjustment_paise || 0);
  return { subtotal_paise: subtotal, tax_paise: tax, total_paise: total, lines: results };
}
