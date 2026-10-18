export declare const FAKE_SESSION_ID: string;
export declare const FAKE_WORKSPACE: string;
export declare const FAKE_ISSUER: string;
export declare const FAKE_LINK: string;
export declare function canonical(value: unknown): string;

export interface FakeRequest {
  method: string;
  path: string;
  ifMatch?: string;
  idempotencyKey?: string;
}
export interface FakeHookContext {
  method: string;
  path: string;
  url: string | URL | Request;
  init: RequestInit;
  route(url: string | URL | Request, init?: RequestInit): Promise<Response>;
}
export type FakeHook = (context: FakeHookContext) => Response | undefined | Promise<Response | undefined>;
export type FakeAnswer =
  Record<string, unknown> | ((interaction: Record<string, unknown>) => Record<string, unknown>);
export interface FakeRuntime {
  fetch: typeof globalThis.fetch;
  route(url: string | URL | Request, init?: RequestInit): Promise<Response>;
  keys: { keys: Record<string, unknown>[] };
  counts: { create: number; retrieve: number; surface: number; complete: number; keys: number };
  requests: FakeRequest[];
  /** Submits an accepted, signed answer to the current revision; returns its event ID. */
  answer(data: Record<string, unknown>): string;
  /** Publishes a next revision (supersession). */
  publish(interaction: Record<string, unknown>): void;
  /** Completes the Session directly, as another owner process would. */
  completeNow(): void;
  setHook(hook: FakeHook | undefined): void;
  setAutoAnswer(answer: FakeAnswer | undefined): void;
  session(): Record<string, any> | undefined;
}
export declare function createFakeRuntime(options?: { autoAnswer?: FakeAnswer }): FakeRuntime;
