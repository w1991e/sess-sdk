// The per-run limits every recipe runs under, enforced here on the client whatever the provider's
// own spend controls are (the Meta Model API has no hard spend cap). The guard sends each model
// request and counts every HTTP request, retries included. Tokens are counted per attempt: the
// usage the provider reported, or the attempt's ceiling when it reported none (a failed or retried
// attempt, a response without usage). A request is sent only if its ceiling still fits the run's
// token caps, so a run never uses more than the caps; maxRunCost() prices exactly that.
// The guard never reads a failed response's body, so a provider error cannot echo a key.

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
  constructor(code, message, status) {
    super(message);
    this.name = 'BoundError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
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
  function charge(input, output, estimated) {
    usage.input_tokens += input;
    usage.output_tokens += output;
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
      await response?.body?.cancel().catch(() => {});
      if (!retryable || attempt >= bounds.backoffMs.length)
        throw new BoundError('provider_failed', `The model request failed (${status}).`, status);
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
    const reported = Number.isFinite(inputTokens) && Number.isFinite(outputTokens);
    charge(
      Number.isFinite(inputTokens) ? inputTokens : ceiling.input,
      Number.isFinite(outputTokens) ? outputTokens : ceiling.output,
      !reported,
    );
    check();
  }

  return {
    bounds,
    deadline,
    post,
    count,
    stats() {
      settle();
      return { ...counts, usage: { ...usage }, models: [...models], elapsed_ms: now() - started };
    },
  };
}
