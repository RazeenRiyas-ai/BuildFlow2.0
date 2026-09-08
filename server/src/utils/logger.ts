import { getRequestId } from './request-context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMetadata {
  [key: string]: unknown;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const VALID_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function readMinLevelFromEnv(): LogLevel {
  // Deliberately reads process.env directly rather than importing config/env.ts: logger.ts is a
  // leaf module used by process-safety.ts, graceful-shutdown.ts, and config/db.ts, and must never
  // gain a dependency that could cycle back to any of them, or that fails before a validated `env`
  // even exists (see config/env.ts's own validation-failure path, which cannot use this logger for
  // exactly that reason).
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  return (VALID_LEVELS as string[]).includes(raw ?? '') ? (raw as LogLevel) : 'info';
}

/**
 * Key-name-based redaction, applied to every metadata object before it is ever serialized —
 * callers are not trusted to remember to scrub secrets themselves. Two tiers:
 *  - password/secret/authorization/cookie/api-key-shaped keys are fully replaced: there is never a
 *    legitimate reason to see even a fragment of these in a log.
 *  - token/jwt-shaped keys (including the Expo push token in push.service.ts) are truncated rather
 *    than removed outright: enough of the value survives to correlate a specific token/session
 *    across log lines or against a database row, without ever reconstructing the original secret.
 * This only recognizes keys by name — it does not scan free-text message strings or values for
 * secret-shaped content. Call sites must still avoid interpolating raw secrets into a message.
 */
const FULLY_REDACT_KEY_PATTERN = /(password|secret|authoriz|cookie|api[-_]?key)/i;
const TRUNCATE_KEY_PATTERN = /(token|jwt)/i;
const MAX_REDACT_DEPTH = 4;

export function truncateSecret(value: string): string {
  if (value.length <= 10) return '[REDACTED]';
  return `${value.slice(0, 6)}…${value.slice(-4)} (len=${value.length})`;
}

function redact(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACT_DEPTH) return '[Truncated: max depth exceeded]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Error) && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (FULLY_REDACT_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else if (TRUNCATE_KEY_PATTERN.test(key) && typeof val === 'string') {
        out[key] = truncateSecret(val);
      } else {
        out[key] = redact(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: 'NonError', message: String(err) };
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  error?: SerializedError;
  [key: string]: unknown;
}

type Sink = (level: LogLevel, line: string) => void;

/** debug/info are routine operational noise → stdout; warn/error need operator attention → stderr.
 * This is also why process-safety.test.ts's `vi.spyOn(console, 'error')` and the graceful-shutdown
 * subprocess tests' stdout/stderr assertions keep working unchanged after this migration: the same
 * console method is still the one ultimately called for a given level. */
const defaultSink: Sink = (level, line) => {
  if (level === 'warn' || level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
};

export interface CreateLoggerOptions {
  minLevel?: LogLevel;
  sink?: Sink;
}

export interface Logger {
  debug(message: string, meta?: LogMetadata): void;
  info(message: string, meta?: LogMetadata): void;
  warn(message: string, meta?: LogMetadata): void;
  error(message: string, error?: unknown, meta?: LogMetadata): void;
}

/**
 * Factory rather than only a singleton so tests can inject their own sink and minLevel instead of
 * spying on console/relying on process.env — see logger.test.ts. Production code should import the
 * shared `logger` export below rather than calling this directly.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const minLevel = options.minLevel ?? readMinLevelFromEnv();
  const sink = options.sink ?? defaultSink;

  function log(level: LogLevel, message: string, meta?: LogMetadata, error?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    const requestId = getRequestId();
    if (requestId) entry.requestId = requestId;

    if (error !== undefined) {
      entry.error = serializeError(error);
    }

    if (meta) {
      const redacted = redact(meta, 0) as LogMetadata;
      Object.assign(entry, redacted);
    }

    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch (stringifyErr) {
      // Never let a bad metadata value (a circular reference, a BigInt) throw out of the logger —
      // a logging call must never be the thing that crashes request handling or, worse, a
      // process-safety/graceful-shutdown handler that is itself the last line of defense.
      line = JSON.stringify({
        timestamp: entry.timestamp,
        level,
        message,
        requestId: entry.requestId,
        loggerError: `failed to serialize log metadata: ${String(stringifyErr)}`,
      });
    }

    sink(level, line);
  }

  return {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, error, meta) => log('error', message, meta, error),
  };
}

/** Shared application logger. Reads LOG_LEVEL from the environment once at module load — debug in
 * local development if set, info and above by default (a sensible production default that keeps
 * routine per-request lines without needing an env var set explicitly everywhere). */
export const logger = createLogger();
