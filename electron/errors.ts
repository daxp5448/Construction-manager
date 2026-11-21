export type ErrorCode = 'VALIDATION' | 'NEEDS_CONFIRM' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'INTERNAL';

export class ApiError extends Error {
  code: ErrorCode;
  fieldErrors?: Record<string, string>;
  warnings?: string[];
  constructor(message: string, code: ErrorCode = 'VALIDATION', extra: { fieldErrors?: Record<string, string>; warnings?: string[] } = {}) {
    super(message);
    this.code = code;
    this.fieldErrors = extra.fieldErrors;
    this.warnings = extra.warnings;
  }
}

export const validation = (message: string, fieldErrors?: Record<string, string>) =>
  new ApiError(message, 'VALIDATION', { fieldErrors });
export const notFound = (what = 'Record') => new ApiError(`${what} not found.`, 'NOT_FOUND');
export const conflict = (message: string) => new ApiError(message, 'CONFLICT');

/** Raise when the user should confirm before saving (duplicates, negative stock…). */
export function needsConfirm(warnings: string[]): never {
  throw new ApiError(warnings[0], 'NEEDS_CONFIRM', { warnings });
}
