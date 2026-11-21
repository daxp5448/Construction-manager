import fs from 'fs';
import path from 'path';
import { getLogDir } from './paths';

const MAX_BYTES = 2 * 1024 * 1024;
let logFile: string | null = null;

function file(): string {
  if (!logFile) logFile = path.join(getLogDir(), 'app.log');
  return logFile;
}

function write(level: string, args: unknown[]) {
  const msg = args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : safeJson(a)))
    .join(' ');
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  try {
    const f = file();
    if (fs.existsSync(f) && fs.statSync(f).size > MAX_BYTES) {
      fs.renameSync(f, f + '.1');
    }
    fs.appendFileSync(f, line);
  } catch {
    /* never let logging crash the app */
  }
  if (process.env.CRM_QUIET_LOG !== '1') {
    (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)(line.trimEnd());
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  info: (...a: unknown[]) => write('INFO', a),
  warn: (...a: unknown[]) => write('WARN', a),
  error: (...a: unknown[]) => write('ERROR', a),
  file: () => file(),
};
