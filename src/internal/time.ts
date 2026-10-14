import { SessError } from '../errors.js';

export function boundedNumber(
  value: number | undefined,
  fallback: number,
  name: string,
  min = 1,
  max = 2_147_483_647,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new SessError('configuration', `${name} is outside its supported range.`, { outcome: 'not_sent' });
  }
  return result;
}

export function deadline(ms: number, parent?: AbortSignal): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new SessError('timeout', 'Operation deadline exceeded.')),
    ms,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}

export function abortError(signal: AbortSignal): SessError {
  return signal.reason instanceof SessError && signal.reason.kind === 'timeout'
    ? new SessError('timeout', 'Operation deadline exceeded.')
    : new SessError('aborted', 'Operation was aborted. Remote work is not cancelled.');
}

/** Enforce deadlines even when a custom fetch/provider fails to observe its signal. */
export function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      reject(abortError(signal));
    };
    if (signal.aborted) {
      promise.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
