/**
 * Polite HTTP client for external academic-metadata APIs (Crossref, Europe PMC).
 *
 * Responsibilities:
 *  - Inject the polite-pool User-Agent on every request (Crossref requires
 *    contact info to avoid being throttled).
 *  - Per-host concurrency limit via an internal semaphore.
 *  - Retry on 429 / 5xx with exponential backoff, honoring `Retry-After`.
 *  - Hard timeout per attempt.
 *
 * The client does not cache — pair it with `ExternalCache` for that.
 */

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs?: number;
  maxRetries?: number;
  perHostConcurrency?: number;
  // Hooks for tests/observability. fetch is injectable so unit tests can
  // exercise retry/backoff without real network.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpRequestOptions {
  // Raise `enrichment_failed` rather than throwing when retries are exhausted.
  // Returns `{ ok: false, status }` instead of throwing.
  failGracefully?: boolean;
  signal?: AbortSignal;
}

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  attempts: number;
  retried: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_PER_HOST_CONCURRENCY = 3;
const MAX_BACKOFF_MS = 30_000;

export class HttpClient {
  private readonly semaphores = new Map<string, Semaphore>();
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly perHostConcurrency: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: HttpClientOptions) {
    if (!opts.userAgent || !opts.userAgent.includes("(")) {
      // Crossref polite pool: User-Agent must include contact info in
      // parentheses, e.g. "rw-screen/0.5.0 (mailto:contact@example.com)".
      throw new Error(
        "HttpClient requires a polite User-Agent containing contact info, e.g. 'name/version (mailto:...)'.",
      );
    }
    this.userAgent = opts.userAgent;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.perHostConcurrency = opts.perHostConcurrency ?? DEFAULT_PER_HOST_CONCURRENCY;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async getJson<T>(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const host = new URL(url).host;
    const semaphore = this.semaphoreFor(host);
    const release = await semaphore.acquire();
    try {
      return await this.fetchWithRetry<T>(url, opts);
    } finally {
      release();
    }
  }

  private semaphoreFor(host: string): Semaphore {
    let s = this.semaphores.get(host);
    if (!s) {
      s = new Semaphore(this.perHostConcurrency);
      this.semaphores.set(host, s);
    }
    return s;
  }

  private async fetchWithRetry<T>(
    url: string,
    opts: HttpRequestOptions,
  ): Promise<HttpResponse<T>> {
    let attempt = 0;
    let lastStatus = 0;
    while (true) {
      attempt += 1;
      const timeoutController = new AbortController();
      const handle = setTimeout(() => timeoutController.abort(), this.timeoutMs);
      const signal = opts.signal
        ? mergeSignals(opts.signal, timeoutController.signal)
        : timeoutController.signal;
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: {
            "User-Agent": this.userAgent,
            Accept: "application/json",
          },
          signal,
        });
      } catch (err) {
        clearTimeout(handle);
        if (attempt > this.maxRetries) {
          if (opts.failGracefully) {
            return { ok: false, status: lastStatus, data: null, attempts: attempt, retried: true };
          }
          throw err;
        }
        await this.sleep(backoffMs(attempt));
        continue;
      }
      clearTimeout(handle);
      lastStatus = response.status;

      if (response.ok) {
        const data = (await response.json()) as T;
        return { ok: true, status: response.status, data, attempts: attempt, retried: attempt > 1 };
      }

      // Non-OK status
      if (isRetryable(response.status) && attempt <= this.maxRetries) {
        const retryAfter = parseRetryAfter(response.headers);
        await this.sleep(retryAfter ?? backoffMs(attempt));
        continue;
      }
      if (opts.failGracefully) {
        return {
          ok: false,
          status: response.status,
          data: null,
          attempts: attempt,
          retried: attempt > 1,
        };
      }
      throw new HttpError(`HTTP ${response.status} for ${url}`, response.status);
    }
  }
}

export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.active += 1;
        resolve(() => this.release());
      };
      if (this.active < this.max) {
        grant();
      } else {
        this.waiters.push(grant);
      }
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfter(headers: Headers): number | null {
  const v = headers.get("retry-after");
  if (!v) return null;
  const seconds = Number(v);
  if (Number.isFinite(seconds)) return Math.min(MAX_BACKOFF_MS, seconds * 1000);
  const date = Date.parse(v);
  if (Number.isFinite(date)) return Math.min(MAX_BACKOFF_MS, Math.max(0, date - Date.now()));
  return null;
}

function backoffMs(attempt: number): number {
  // attempt is 1-based; first retry waits ~1s, second ~2s, third ~4s.
  return Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, attempt - 1));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return ctrl.signal;
}
