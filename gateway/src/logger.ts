export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const resolveLogLevel = (): LogLevel => {
  const raw = (
    process.env.GATEWAY_LOG_LEVEL ??
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
  )
    .toString()
    .trim()
    .toLowerCase();

  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }

  return 'info';
};

const MIN_LEVEL = resolveLogLevel();
const MIN_RANK = LEVELS[MIN_LEVEL];

const shouldLog = (level: LogLevel): boolean => LEVELS[level] >= MIN_RANK;

/** Context object for structured logging with correlation ID */
export interface LogContext {
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Check if the argument is a LogContext object (has requestId or is a plain object)
 */
const isLogContext = (arg: unknown): arg is LogContext => {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && !(arg instanceof Error);
};

/**
 * Format structured context as key=value pairs for log correlation.
 */
const formatContext = (context: LogContext): string => {
  const pairs = Object.entries(context)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return pairs;
};

export const logDebug = (...args: unknown[]): void => {
  if (shouldLog('debug')) {
    // Check if last arg is a context object with requestId
    const lastArg = args[args.length - 1];
    if (args.length >= 2 && isLogContext(lastArg) && 'requestId' in lastArg) {
      const context = args.pop() as LogContext;
      console.debug(...args, formatContext(context));
    } else {
      console.debug(...args);
    }
  }
};

export const logInfo = (...args: unknown[]): void => {
  if (shouldLog('info')) {
    const lastArg = args[args.length - 1];
    if (args.length >= 2 && isLogContext(lastArg) && 'requestId' in lastArg) {
      const context = args.pop() as LogContext;
      console.log(...args, formatContext(context));
    } else {
      console.log(...args);
    }
  }
};

export const logWarn = (...args: unknown[]): void => {
  if (shouldLog('warn')) {
    const lastArg = args[args.length - 1];
    if (args.length >= 2 && isLogContext(lastArg) && 'requestId' in lastArg) {
      const context = args.pop() as LogContext;
      console.warn(...args, formatContext(context));
    } else {
      console.warn(...args);
    }
  }
};

export const logError = (...args: unknown[]): void => {
  if (shouldLog('error')) {
    const lastArg = args[args.length - 1];
    if (args.length >= 2 && isLogContext(lastArg) && 'requestId' in lastArg) {
      const context = args.pop() as LogContext;
      console.error(...args, formatContext(context));
    } else {
      console.error(...args);
    }
  }
};
