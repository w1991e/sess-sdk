// The per-run limits every recipe runs under, enforced here on the client whatever the provider's
// own spend controls are (the Meta Model API has no hard spend cap). The guard sends each model
// request and counts every HTTP request, retries included. Tokens are counted per attempt: the
// usage the provider reported, or the attempt's ceiling when it reported none (a failed or retried
// attempt, a response without usage). A request is sent only if its ceiling still fits the run's
// token caps, so a run never uses more than the caps; maxRunCost() prices exactly that.
// Of a failed response's body the guard keeps only the provider's short error name (errorReason),
// so a provider error cannot echo a key.

export const BOUNDS = Object.freeze({
  /** Model calls (turns) per run. */
  maxCalls: 10,
  /** HTTP requests per run, every retry included. */
  maxRequests: 12,
  /** max_output_tokens / max_tokens per request, reasoning included. */
  maxOutputTokens: 2000,
  /** Per-run token caps, every attempt included. */
  maxRunInputTokens: 80_000,
  maxRunOutputTokens: 20_000,
  /**
   * A request's input-token ceiling is its UTF-8 body bytes (a token covers at least one byte)
   * plus this allowance for what the provider adds around tools and system text.
   */
  inputOverheadTokens: 1000,
  /** One request's timeout. */
  callTimeoutMs: 60_000,
  /** Retries per call, on 429, 5xx or a network failure only; the waits before each retry. */
  backoffMs: Object.freeze([1000, 4000]),
  /** The whole run, human waits included. */
  wallMs: 20 * 60_000,
});

/** The most a run can cost under `bounds` at `rates` (USD per 1M tokens), retries included. */
export function maxRunCost(rates, bounds = BOUNDS) {
  return (bounds.maxRunInputTokens * rates.input + bounds.maxRunOutputTokens * rates.output) / 1e6;
}

/** A bound was reached or a call failed for good; `code` is stable, the message carries no body. */
export class BoundError extends Error {
  constructor(code, message, status, reason) {
    super(message);
    this.name = 'BoundError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (reason) this.reason = reason;
  }
}

/**
 * The provider's own error name from a failed response (Google `error.status` such as NOT_FOUND,
 * OpenAI-style `error.code` / `error.type` such as model_not_found), or null. Only a short
 * letters-and-underscores name is taken; no message, number or other body text is kept, so a
 * provider error can never echo a key into a log or record.
 */
async function errorReason(response) {
  try {
    const text = await response.text();
    if (text.length > 65_536) return null;
    const error = JSON.parse(text)?.error;
    for (const value of [error?.status, error?.code, error?.type])
      if (typeof value === 'string' && /^[A-Za-z][A-Za-z_]{2,39}$/.test(value)) return value;
  } catch {}
  return null;
}

export function createGuard({
  bounds = BOUNDS,
  fetch = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
  const started = now();
  const usage = { input_tokens: 0, output_tokens: 0 };
  const counts = { calls: 0, requests: 0, retries: 0, estimated_attempts: 0 };
  const models = new Set();
  const deadline = started + bounds.wallMs;
  /** The last successful attempt's ceiling, charged unless count() reports its usage. */
  let pending = null;

  const stop = (code, message) => {
    throw new BoundError(code, message);
  };
  /** The tokens the provider reported, and the ceilings charged where it reported none. */
  const reported = { input_tokens: 0, output_tokens: 0, attempts: 0 };
  const atCeiling = { input_tokens: 0, output_tokens: 0, attempts: 0 };
  function charge(input, output, estimated) {
    usage.input_tokens += input;
    usage.output_tokens += output;
    const into = estimated ? atCeiling : reported;
    into.input_tokens += input;
    into.output_tokens += output;
    into.attempts++;
    if (estimated) counts.estimated_attempts++;
  }
  function settle() {
    if (pending) charge(pending.input, pending.output, true);
    pending = null;
  }
  function check() {
    if (now() >= deadline) stop('wall_clock', 'The run reached its 20-minute limit.');
    if (usage.input_tokens >= bounds.maxRunInputTokens)
      stop('input_token_cap', 'The run reached its input-token cap.');
    if (usage.output_tokens >= bounds.maxRunOutputTokens)
      stop('output_token_cap', 'The run reached its output-token cap.');
  }

  /** POSTs one model request (JSON), with the bounded retries. Returns the parsed JSON body. */
  async function post(url, headers, body) {
    settle(); // a previous response whose usage was never reported is charged at its ceiling
    check();
    if (counts.calls >= bounds.maxCalls)
      stop('max_calls', `The run reached its ${bounds.maxCalls}-call limit.`);
    counts.calls++;
    const text = JSON.stringify(body);
    const ceiling = {
      input: Buffer.byteLength(text) + bounds.inputOverheadTokens,
      output: bounds.maxOutputTokens,
    };
    for (let attempt = 0; ; attempt++) {
      const left = deadline - now();
      if (left <= 0) stop('wall_clock', 'The run reached its 20-minute limit.');
      if (counts.requests >= bounds.maxRequests)
        stop('max_requests', `The run reached its ${bounds.maxRequests}-request limit.`);
      if (
        usage.input_tokens + ceiling.input > bounds.maxRunInputTokens ||
        usage.output_tokens + ceiling.output > bounds.maxRunOutputTokens
      )
        stop('token_cap', 'The next request could pass the run token caps, so it was not sent.');
      counts.requests++;
      let response = null;
      let failure = 'network';
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: text,
          redirect: 'error',
          signal: AbortSignal.timeout(Math.min(bounds.callTimeoutMs, left)),
        });
      } catch (error) {
        failure = error?.name === 'TimeoutError' ? 'timeout' : 'network';
      }
      if (response?.ok) {
        const json = await response.json().catch(() => undefined);
        if (json !== undefined) {
          pending = ceiling;
          return json;
        }
        response = null;
        failure = 'unreadable';
      }
      // A failed attempt may still have been billed: its ceiling is charged.
      charge(ceiling.input, ceiling.output, true);
      const status = response ? response.status : failure;
      const retryable = !response || response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= bounds.backoffMs.length) {
        const reason = response ? await errorReason(response) : null;
        throw new BoundError(
          'provider_failed',
          `The model request failed (${status}${reason ? ` ${reason}` : ''}).`,
          status,
          reason,
        );
      }
      await response?.body?.cancel().catch(() => {});
      counts.retries++;
      await sleep(bounds.backoffMs[attempt]);
    }
  }

  /**
   * The usage the provider reported for the last response, and the model id it named. A missing
   * count is charged at that attempt's ceiling. Stops the run once a cap is reached.
   */
  function count(inputTokens, outputTokens, model) {
    if (typeof model === 'string' && model) models.add(model);
    const ceiling = pending ?? { input: 0, output: 0 };
    pending = null;
    const hasIn = Number.isFinite(inputTokens);
    const hasOut = Number.isFinite(outputTokens);
    if (hasIn && hasOut) charge(inputTokens, outputTokens, false);
    else if (!hasIn && !hasOut) charge(ceiling.input, ceiling.output, true);
    else {
      // One count reported: it is usage; the missing one is charged at its ceiling.
      charge(hasIn ? inputTokens : 0, hasOut ? outputTokens : 0, false);
      charge(hasIn ? 0 : ceiling.input, hasOut ? 0 : ceiling.output, true);
    }
    check();
  }

  return {
    bounds,
    deadline,
    post,
    count,
    stats() {
      settle();
      return {
        ...counts,
        usage: { ...usage },
        usage_reported: { ...reported },
        usage_at_ceiling: { ...atCeiling },
        models: [...models],
        elapsed_ms: now() - started,
      };
    },
  };
}
