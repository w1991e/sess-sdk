export interface AuditException {
  id: string;
  package: string;
  reason: string;
  until: string;
  untilMs: number;
}
export interface ParsedExceptions {
  exceptions: AuditException[];
  errors: string[];
}
export interface NpmRun {
  status: number | null;
  signal?: string | null;
  error?: Error;
  stdout: string;
}
export interface Excepted {
  id: string;
  package: string;
  severity: string;
  title?: string;
  until: string;
  reason: string;
}
export declare const EXCEPTIONS_PATH: string;
export declare const NPM_ARGS: string[];
export declare function parseExceptions(text: string): ParsedExceptions;
export declare function evaluate(input: { npm: NpmRun; exceptions: ParsedExceptions; now: Date }): {
  ok: boolean;
  failures: string[];
  excepted: Excepted[];
};
