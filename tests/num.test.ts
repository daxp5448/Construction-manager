import test from 'node:test';
import assert from 'node:assert/strict';
import { formatINR, formatQty, groupIndian, mulQtyRate, parseMoney, parsePct, parseQty, pctOf, taxInside, financialYear, normalizeVehicle, moneyToInput } from '../src/shared/num';
import { computeLine, computeTotals } from '../src/shared/purchase';
import { evaluateFormula, validateFormula } from '../src/shared/formula';
import { convertMilli, SEED_UNITS } from '../src/shared/units';
import { judgeTest, measureQty, netWeight } from '../src/shared/modules';

test('money parsing is exact (no float drift)', () => {
  assert.equal(parseMoney('1,234.50'), 123450);
  assert.equal(parseMoney('0.1'), 10);
  assert.equal(parseMoney('19.999'), 2000); // rounds half-up at the 3rd decimal
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('₹ 5,00,000'), 50000000);
  assert.equal(moneyToInput(123450), '1234.5');
});

test('quantity & percent parsing', () => {
  assert.equal(parseQty('24.5'), 24500);
  assert.equal(parseQty('0.001'), 1);
  assert.equal(parsePct('18'), 1800);
  assert.equal(parsePct('2.5'), 250);
});

test('Indian formatting', () => {
  assert.equal(groupIndian('1234567'), '12,34,567');
  assert.equal(formatINR(12345678), '₹ 1,23,456.78');
  assert.equal(formatINR(-50000), '-₹ 500.00');
  assert.equal(formatINR(99, { decimals: 0 }), '₹ 1');
  assert.equal(formatQty(24500, 'MT'), '24.50 MT');
  assert.equal(formatQty(24375), '24.375');
});

test('Subtotal = Qty × Rate; Tax = Subtotal × Tax% / 100', () => {
  // 24.500 MT × ₹ 1,250.00 = ₹ 30,625.00
  assert.equal(mulQtyRate(24500, 125000), 3062500);
  // 18% of 30,625.00 = 5,512.50
  assert.equal(pctOf(3062500, 1800), 551250);
  // large values don't overflow float precision
  assert.equal(mulQtyRate(999_999_999, 99_999_999), Number((999_999_999n * 99_999_999n + 500n) / 1000n));
});

test('purchase grand total = subtotal + tax + freight + other (+ adjustment)', () => {
  const t = computeTotals(
    'exclusive',
    [
      { qty_milli: 24500, rate_paise: 125000, tax_bp: 500 },
      { qty_milli: 10000, rate_paise: 90000, tax_bp: 500 },
    ],
    { freight_paise: 150000, other_charges_paise: 25000, adjustment_paise: -5000 }
  );
  // line1: 30,625.00 + 5% (1,531.25) ; line2: 9,000.00 + 5% (450.00)
  assert.equal(t.subtotal_paise, 3062500 + 900000);
  assert.equal(t.tax_paise, 153125 + 45000);
  assert.equal(t.total_paise, 3962500 + 198125 + 150000 + 25000 - 5000);
});

test('tax-inclusive and exempt treatments', () => {
  const inc = computeLine('inclusive', { qty_milli: 1000, rate_paise: 11800, tax_bp: 1800 });
  assert.deepEqual(inc, { subtotal_paise: 10000, tax_paise: 1800, total_paise: 11800 });
  assert.equal(taxInside(11800, 1800), 1800);
  const ex = computeLine('exempt', { qty_milli: 2000, rate_paise: 5000, tax_bp: 1800 });
  assert.deepEqual(ex, { subtotal_paise: 10000, tax_paise: 0, total_paise: 10000 });
});

test('net weight = gross − tare', () => {
  assert.equal(netWeight(38_250, 14_100), 24_150);
  assert.equal(netWeight(null, 1), null);
});

test('formula evaluator is safe and correct', () => {
  assert.equal(evaluateFormula('N*L*W*D', { L: 10, W: 3.5, D: 0.2, N: 2 }), 14);
  assert.equal(evaluateFormula('(L+W)*2', { L: 4, W: 1 }), 10);
  assert.equal(evaluateFormula('-L + 10', { L: 4 }), 6);
  assert.throws(() => evaluateFormula('L*X', { L: 1 }), /Unknown variable/);
  assert.throws(() => evaluateFormula('process.exit()', {}));
  assert.throws(() => evaluateFormula('1/0', {}), /Division/);
  assert.equal(validateFormula('L*W*D'), null);
  assert.ok(validateFormula('L**') !== null);
  assert.ok(validateFormula('constructor') !== null);
});

test('measurement quantity: custom formula vs. product of entered dimensions', () => {
  assert.equal(measureQty({ length_milli: 100000, width_milli: 7000, depth_milli: 150, nos_milli: 1000 }), 105000); // 100*7*0.15 = 105
  assert.equal(measureQty({ length_milli: 100000, width_milli: 7000, nos_milli: 2000, __formula: 'N*L*W' }), 1_400_000);
  assert.equal(measureQty({}), null);
});

test('test pass/fail only judged against user-entered limits', () => {
  assert.equal(judgeTest({ result_value: '24', limit_max: 30 }), 'pass');
  assert.equal(judgeTest({ result_value: '31', limit_max: 30 }), 'fail');
  assert.equal(judgeTest({ result_value: '5', limit_min: 6 }), 'fail');
  assert.equal(judgeTest({ result_value: '24' }), null); // no limits => never invent a verdict
  assert.equal(judgeTest({ result_value: 'Conforms', limit_max: 30 }), null);
});

test('unit conversion respects kinds', () => {
  const u = (c: string) => SEED_UNITS.find((x) => x.code === c);
  assert.equal(convertMilli(24000, u('Kg'), u('MT')), 24);
  assert.equal(convertMilli(1000, u('MT'), u('Kg')), 1_000_000);
  assert.equal(convertMilli(1000, u('MT'), u('Brass')), null); // weight → volume needs a density: never assumed
  assert.equal(convertMilli(5, u('Bags'), u('Nos')), null);
});

test('misc helpers', () => {
  assert.equal(financialYear('2026-03-31'), '2025-26');
  assert.equal(financialYear('2026-04-01'), '2026-27');
  assert.equal(normalizeVehicle('gj 01 ab-1234'), 'GJ01AB1234');
});
