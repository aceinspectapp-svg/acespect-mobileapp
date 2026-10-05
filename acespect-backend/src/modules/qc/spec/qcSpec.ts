/**
 * Runtime for the requirements spec (Inspection-Defect-Platform_Requirements
 * v0.2, sections 6 and 7). qcSpec.json holds every entity (E01..E37) and
 * workflow form (F01..F43) extracted from the document: field labels, types,
 * mandatory/optional/conditional flags and allowed values. The server
 * validates against it and acespect-web renders its forms from it
 * (GET /qc/spec), so a field is defined once.
 */
import specJson from './qcSpec.data.json';
import { ApiError } from '../../../utils/ApiError';

export type FieldKind =
  | 'text' | 'longtext' | 'select' | 'multiselect' | 'bool' | 'date' | 'datetime' | 'int' | 'decimal' | 'currency'
  | 'email' | 'phone' | 'abn' | 'acn' | 'address' | 'ref' | 'refs' | 'file' | 'files' | 'composite' | 'system';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  /** M mandatory, O optional, C conditional, S system-generated. */
  req: 'M' | 'O' | 'C' | 'S';
  group: string;
  rules?: string;
  notes?: string;
  min?: number;
  max?: number;
  options?: string[];
  ref?: string | null;
  parts?: Array<{ label: string; kind: FieldKind }>;
  requiredWhen?: { field: string; in: string[] };
  /** Supplied by the server (e.g. the defect being acted on); form renderers skip it. */
  hidden?: boolean;
  system: boolean;
}

export interface FormSpec {
  code: string;
  title: string;
  description: string;
  usedBy: string;
  actions: string;
  fields: FieldSpec[];
}

interface SpecFile {
  entities: Record<string, FormSpec>;
  forms: Record<string, FormSpec>;
  enums: { roles: string[]; severities: string[] };
}

export const SPEC = specJson as unknown as SpecFile;

const EXTRA_FORMS: Record<string, FormSpec> = {};

/** Registers forms the spec describes only in prose (see qc.lifecycle.ts); they validate and render like any other. */
export function registerExtraForms(forms: Record<string, FormSpec>) {
  Object.assign(EXTRA_FORMS, forms);
}

export function getForm(code: string): FormSpec {
  const form = SPEC.entities[code] ?? SPEC.forms[code] ?? EXTRA_FORMS[code];
  if (!form) throw new Error(`Unknown spec code ${code}`);
  return form;
}

/** Everything the web/mobile form renderer needs, in one payload. */
export function getSpecPayload() {
  return { ...SPEC, extraForms: EXTRA_FORMS };
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidateOptions {
  /** PATCH-style: only validate keys that are present; mandatory fields are not enforced. */
  partial?: boolean;
  /** Treat these fields as not required (e.g. supplied by the server). */
  skipRequired?: string[];
  /** Force these fields to be required regardless of the spec flag. */
  extraRequired?: string[];
}

// ───────────────────────── Australian format helpers ─────────────────────────

export function isValidAbn(raw: string): boolean {
  const digits = raw.replace(/\s+/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const nums = digits.split('').map(Number);
  nums[0] = nums[0]! - 1;
  const total = nums.reduce((sum, n, i) => sum + n * weights[i]!, 0);
  return total % 89 === 0;
}

export function isValidAcn(raw: string): boolean {
  const digits = raw.replace(/\s+/g, '');
  if (!/^\d{9}$/.test(digits)) return false;
  const nums = digits.split('').map(Number);
  const weights = [8, 7, 6, 5, 4, 3, 2, 1];
  const sum = weights.reduce((acc, w, i) => acc + w * nums[i]!, 0);
  const check = (10 - (sum % 10)) % 10;
  return check === nums[8];
}

/** Returns E.164 (+61...) or null when the number isn't a valid Australian mobile/landline/business line. */
export function normaliseAuPhone(raw: string): string | null {
  const s = raw.replace(/[\s()-]/g, '');
  if (/^(13\d{4}|1300\d{6}|1800\d{6})$/.test(s)) return s;
  let national: string;
  if (s.startsWith('+61')) national = '0' + s.slice(3);
  else if (s.startsWith('0')) national = s;
  else return null;
  if (/^04\d{8}$/.test(national)) return '+61' + national.slice(1);
  if (/^0[2378]\d{8}$/.test(national)) return '+61' + national.slice(1);
  return null;
}

const STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'];
const POSTCODE_RANGES: Record<string, Array<[number, number]>> = {
  VIC: [[3000, 3999], [8000, 8999]],
  NSW: [[1000, 2599], [2619, 2899], [2921, 2999]],
  QLD: [[4000, 4999], [9000, 9999]],
  SA: [[5000, 5999]],
  WA: [[6000, 6797], [6800, 6999]],
  TAS: [[7000, 7999]],
  ACT: [[200, 299], [2600, 2618], [2900, 2920]],
  NT: [[800, 999]],
};
const STREET_TYPES = ['Street', 'Road', 'Avenue', 'Crescent', 'Court', 'Drive', 'Parade', 'Place', 'Way', 'Lane', 'Boulevard', 'Close', 'Terrace', 'Highway', 'Other'];

function postcodeMatchesState(postcode: string, state: string): boolean {
  const n = Number(postcode);
  return (POSTCODE_RANGES[state] ?? []).some(([lo, hi]) => n >= lo && n <= hi);
}

// ───────────────────────── Validator ─────────────────────────

const isEmpty = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : String(v);
}

function coerceBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'on' || v === '1') return true;
  if (v === 'false' || v === 'off' || v === '0') return false;
  return undefined;
}

function validateValue(f: FieldSpec, value: unknown, issues: ValidationIssue[]): unknown {
  const bad = (message: string) => {
    issues.push({ field: f.key, message });
    return undefined;
  };
  switch (f.kind) {
    case 'text':
    case 'longtext': {
      const s = str(value);
      const max = f.max ?? (f.kind === 'longtext' ? 4000 : undefined);
      if (f.min && s.length < f.min) return bad(`${f.label} must be at least ${f.min} characters`);
      if (max && s.length > max) return bad(`${f.label} must be at most ${max} characters`);
      return s;
    }
    case 'select': {
      const s = str(value);
      if (f.options && !f.options.includes(s)) return bad(`${f.label}: "${s}" is not an allowed value`);
      return s;
    }
    case 'multiselect': {
      const arr = Array.isArray(value) ? value.map(str) : [str(value)];
      if (f.options) {
        const invalid = arr.filter((x) => !f.options!.includes(x));
        if (invalid.length) return bad(`${f.label}: not an allowed value: ${invalid.join(', ')}`);
      }
      return arr;
    }
    case 'bool': {
      const b = coerceBool(value);
      return b === undefined ? bad(`${f.label} must be yes or no`) : b;
    }
    case 'date': {
      const s = str(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s + 'T00:00:00Z').getTime())) {
        return bad(`${f.label} must be a date (YYYY-MM-DD)`);
      }
      return s;
    }
    case 'datetime': {
      const s = str(value);
      return Number.isNaN(new Date(s).getTime()) ? bad(`${f.label} must be a date and time`) : new Date(s).toISOString();
    }
    case 'int':
    case 'decimal':
    case 'currency': {
      const n = typeof value === 'number' ? value : Number(str(value));
      if (!Number.isFinite(n)) return bad(`${f.label} must be a number`);
      if (f.kind === 'int' && !Number.isInteger(n)) return bad(`${f.label} must be a whole number`);
      if (f.min !== undefined && n < f.min) return bad(`${f.label} must be at least ${f.min}`);
      if (f.max !== undefined && n > f.max) return bad(`${f.label} must be at most ${f.max}`);
      return n;
    }
    case 'email': {
      const s = str(value).toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : bad(`${f.label} must be a valid email address`);
    }
    case 'phone': {
      const p = normaliseAuPhone(str(value));
      return p ?? bad(`${f.label} must be an Australian phone number (04XX XXX XXX or +61 4XX XXX XXX)`);
    }
    case 'abn': {
      const s = str(value).replace(/\s+/g, '');
      return isValidAbn(s) ? s : bad(`${f.label} is not a valid ABN (11 digits, checksum failed)`);
    }
    case 'acn': {
      const s = str(value).replace(/\s+/g, '');
      return isValidAcn(s) ? s : bad(`${f.label} is not a valid ACN (9 digits, check digit failed)`);
    }
    case 'address': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return bad(`${f.label} must be an address`);
      const a = value as Record<string, unknown>;
      const missing = ['streetNumber', 'streetName', 'streetType', 'suburb', 'state', 'postcode'].filter((k) => isEmpty(a[k]));
      if (missing.length) return bad(`${f.label} is missing: ${missing.join(', ')}`);
      const state = str(a.state);
      const postcode = str(a.postcode);
      if (!STATES.includes(state)) return bad(`${f.label}: state must be one of ${STATES.join(', ')}`);
      if (!/^\d{4}$/.test(postcode)) return bad(`${f.label}: postcode must be 4 digits`);
      if (!postcodeMatchesState(postcode, state)) return bad(`${f.label}: postcode ${postcode} does not belong to ${state}`);
      const streetType = str(a.streetType);
      if (!STREET_TYPES.includes(streetType)) return bad(`${f.label}: street type "${streetType}" is not recognised`);
      return {
        unit: isEmpty(a.unit) ? undefined : str(a.unit),
        streetNumber: str(a.streetNumber),
        streetName: str(a.streetName),
        streetType,
        suffix: isEmpty(a.suffix) ? undefined : str(a.suffix),
        suburb: str(a.suburb),
        state,
        postcode,
        country: isEmpty(a.country) ? 'Australia' : str(a.country),
      };
    }
    case 'ref':
      return typeof value === 'string' ? value : bad(`${f.label} must be a reference`);
    case 'refs':
      return Array.isArray(value) && value.every((x) => typeof x === 'string') ? value : bad(`${f.label} must be a list of references`);
    case 'file':
      return typeof value === 'string' ? value : bad(`${f.label} must be a file`);
    case 'files':
      return Array.isArray(value) ? value.map(str) : bad(`${f.label} must be a list of files`);
    case 'composite': {
      if (!Array.isArray(value)) return bad(`${f.label} must be a list of values`);
      return value.map((v) => (v === null || v === undefined ? '' : typeof v === 'number' ? v : str(v)));
    }
    default:
      return value;
  }
}

/**
 * Validates `input` against spec `code` and returns only the user-editable
 * fields, normalised (phones to E.164, ABNs without spaces, emails lower-cased...).
 * System-generated fields in the input are silently dropped.
 */
export function validateAgainstSpec(
  code: string,
  input: Record<string, unknown>,
  opts: ValidateOptions = {},
): { data: Record<string, unknown>; issues: ValidationIssue[] } {
  const form = getForm(code);
  const issues: ValidationIssue[] = [];
  const data: Record<string, unknown> = {};

  const effective = (key: string) => (key in input ? input[key] : undefined);

  for (const f of form.fields) {
    if (f.system || f.hidden) continue;
    const value = input[f.key];
    const present = !isEmpty(value);

    let required = f.req === 'M' || (opts.extraRequired ?? []).includes(f.key);
    if (!required && f.req === 'C' && f.requiredWhen) {
      const driver = effective(f.requiredWhen.field);
      required = typeof driver === 'string' && f.requiredWhen.in.includes(driver);
    }
    if ((opts.skipRequired ?? []).includes(f.key)) required = false;

    if (!present) {
      if (required && !opts.partial) issues.push({ field: f.key, message: `${f.label} is required` });
      continue;
    }
    const cleaned = validateValue(f, value, issues);
    if (cleaned !== undefined) data[f.key] = cleaned;
  }
  return { data, issues };
}

/** Validates and throws a 400 listing every problem when anything is wrong. */
export function validateOrThrow(code: string, input: Record<string, unknown>, opts: ValidateOptions = {}) {
  const { data, issues } = validateAgainstSpec(code, input, opts);
  if (issues.length) {
    throw ApiError.badRequest(
      `${getForm(code).title}: ${issues.map((i) => i.message).join('; ')}`,
      Object.fromEntries(issues.map((i) => [i.field, [i.message]])),
    );
  }
  return data;
}
