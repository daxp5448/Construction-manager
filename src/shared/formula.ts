/**
 * Tiny, safe arithmetic expression evaluator for user-configured quantity formulas
 * (e.g. "L*W*D", "N*L*W*D/1000"). No eval / Function: only numbers, variables,
 * + - * / ( ) and unary minus. Variables are identifiers (letters/digits/_).
 */
type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new Error(`Invalid number "${src.slice(i, j)}"`);
      out.push({ t: 'num', v: n });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j).toUpperCase() });
      i = j;
    } else if ('+-*/()'.includes(c) || c === '×' || c === '÷') {
      out.push({ t: 'op', v: c === '×' ? '*' : c === '÷' ? '/' : c });
      i++;
    } else {
      throw new Error(`Unexpected character "${c}"`);
    }
  }
  return out;
}

export function evaluateFormula(expr: string, vars: Record<string, number>): number {
  const toks = tokenize(expr);
  let p = 0;
  const upper: Record<string, number> = {};
  for (const k of Object.keys(vars)) upper[k.toUpperCase()] = vars[k];

  const peek = () => toks[p];
  const parseExpr = (): number => {
    let v = parseTerm();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = toks[p++].v;
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const parseTerm = (): number => {
    let v = parseUnary();
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = toks[p++].v;
      const r = parseUnary();
      if (op === '/' && r === 0) throw new Error('Division by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const parseUnary = (): number => {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      p++;
      const v = parseUnary();
      return t.v === '-' ? -v : v;
    }
    return parsePrimary();
  };
  const parsePrimary = (): number => {
    const t = toks[p++];
    if (!t) throw new Error('Unexpected end of formula');
    if (t.t === 'num') return t.v;
    if (t.t === 'id') {
      if (!(t.v in upper)) throw new Error(`Unknown variable "${t.v}"`);
      return upper[t.v];
    }
    if (t.v === '(') {
      const v = parseExpr();
      const c = toks[p++];
      if (!c || c.v !== ')') throw new Error('Missing closing bracket');
      return v;
    }
    throw new Error(`Unexpected "${t.v}"`);
  };

  const result = parseExpr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return result;
}

export function validateFormula(expr: string, vars: string[] = ['L', 'W', 'D', 'N']): string | null {
  try {
    const sample: Record<string, number> = {};
    vars.forEach((v) => (sample[v] = 1));
    evaluateFormula(expr, sample);
    return null;
  } catch (e: any) {
    return e.message as string;
  }
}
