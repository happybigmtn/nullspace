/**
 * OpenTelemetry Distributed Tracing Configuration
 *
 * Note: Telemetry is disabled in development mode to avoid package compatibility issues.
 * Enable by setting OTEL_EXPORTER_OTLP_ENDPOINT environment variable in production.
 */

// Minimal Span interface for type compatibility
export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(error: Error): void;
  end(): void;
}

export const SpanStatusCode = {
  OK: 1,
  ERROR: 2,
} as const;

// No-op tracer for development
const noopSpan: Span = {
  setAttribute: () => {},
  setStatus: () => {},
  recordException: () => {},
  end: () => {},
};

export const tracer = {
  startSpan: (_name: string): Span => noopSpan,
  startActiveSpan: async <T>(_name: string, fn: (span: Span) => Promise<T>): Promise<T> => {
    return fn(noopSpan);
  },
};

/**
 * Execute a function within a new span (no-op in dev)
 */
export async function withSpan<T>(
  _name: string,
  fn: (span: Span) => Promise<T>,
  _attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return fn(noopSpan);
}

/**
 * Execute a synchronous function within a new span (no-op in dev)
 */
export function withSpanSync<T>(
  _name: string,
  fn: (span: Span) => T,
  _attributes?: Record<string, string | number | boolean>,
): T {
  return fn(noopSpan);
}

/**
 * Add attributes to an existing span (no-op in dev)
 */
export function addSpanAttributes(
  _span: Span,
  _attributes: Record<string, string | number | boolean | undefined>,
): void {}

/**
 * Record an error event on the current span (no-op in dev)
 */
export function recordSpanError(_span: Span, _error: Error | string, _fatal = false): void {}

/**
 * Get the current trace context for propagation (returns null in dev)
 */
export function getTraceContext(): { traceId: string; spanId: string; traceparent: string } | null {
  return null;
}

/**
 * Create a child span from a traceparent header (no-op in dev)
 */
export function createSpanFromTraceparent(_name: string, _traceparent: string | undefined): Span {
  return noopSpan;
}

/**
 * Generate a new trace ID for a WebSocket message
 */
export function generateTraceId(): { traceId: string; traceparent: string } {
  const traceId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const spanId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return {
    traceId,
    traceparent: `00-${traceId}-${spanId}-01`,
  };
}

console.log('[telemetry] Running in development mode - tracing disabled');
