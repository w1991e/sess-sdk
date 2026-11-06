export declare const FAKE_SESSION_ID: string;
export declare const FAKE_WORKSPACE: string;
export declare const FAKE_ISSUER: string;
export declare const FAKE_LINK: string;
export declare const FAKE_ASK_ID: string;
export declare const FAKE_ASK_LINK: string;
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
  counts: {
    create: number;
    retrieve: number;
    surface: number;
    complete: number;
    keys: number;
    askCreate: number;
    askRead: number;
    askClose: number;
    respondentRetrieve: number;
  };
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
  /** A person presses Start on the Ask link: their Session's ID, or undefined when refused. */
  start(): string | undefined;
  /** That respondent answers with a signed receipt; returns its event ID. */
  answerRespondent(id: string, data: Record<string, unknown>): string;
  setAutoRespondents(list: (Record<string, unknown> | null)[] | undefined): void;
  purge(id: string): void;
  tamper(id: string, change: (respondent: Record<string, any>) => void): void;
  expireAsk(): void;
  /** The Ask's create body and the round one each respondent's Session stores. */
  ask(): { body: Record<string, any>; interaction: Record<string, any> } | undefined;
  respondents(): Record<string, any>[];
}
export declare function createFakeRuntime(options?: {
  autoAnswer?: FakeAnswer;
  autoRespondents?: (Record<string, unknown> | null)[];
}): FakeRuntime;
