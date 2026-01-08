/**
 * OpenTelemetry Distributed Tracing Configuration
 *
 * Provides automatic HTTP/WS instrumentation plus manual span helpers
 * for detailed tracing of casino game operations.
 *
 * Configuration:
 *   OTEL_EXPORTER_OTLP_ENDPOINT - OTLP endpoint (e.g., http://tempo:4318/v1/traces)
 *   OTEL_SERVICE_NAME - Service name (defaults to nullspace-gateway)
 *
 * Usage:
 *   import { tracer, withSpan, addSpanAttributes } from './telemetry.js';
 *   const result = await withSpan('game.blackjack.deal', async (span) => {
 *     addSpanAttributes(span, { 'game.bet_amount': 100, 'game.player_id': 'abc' });
 *     return await dealCards();
 *   });
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';
import {
  trace,
  context,
  SpanStatusCode,
  type Span,
  type Tracer,
  type SpanContext,
  propagation,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'nullspace-gateway';
const SERVICE_VERSION = process.env.npm_package_version || '0.1.0';
const DEPLOYMENT_ENV = process.env.NODE_ENV || 'development';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

// Initialize SDK only if endpoint is configured
if (endpoint) {
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: DEPLOYMENT_ENV,
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy instrumentations
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(`[telemetry] OpenTelemetry tracing enabled → ${endpoint}`);

  const shutdown = (): void => {
    sdk.shutdown().catch((err) => {
      console.warn('[telemetry] failed to shut down OTLP exporter', err);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Set up W3C Trace Context propagation for cross-service tracing
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

/**
 * Get the global tracer for this service
 */
export const tracer: Tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);

/**
 * Execute a function within a new span
 *
 * @example
 * const result = await withSpan('game.submit', async (span) => {
 *   span.setAttribute('game.type', 'blackjack');
 *   return await submitTransaction();
 * });
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          span.setAttribute(key, value);
        }
      }
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Execute a synchronous function within a new span
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes?: Record<string, string | number | boolean>,
): T {
  const span = tracer.startSpan(name);
  try {
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
      }
    }
    const result = fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Add attributes to an existing span
 */
export function addSpanAttributes(
  span: Span,
  attributes: Record<string, string | number | boolean | undefined>,
): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      span.setAttribute(key, value);
    }
  }
}

/**
 * Record an error event on the current span
 */
export function recordSpanError(span: Span, error: Error | string, fatal = false): void {
  const err = typeof error === 'string' ? new Error(error) : error;
  span.recordException(err);
  if (fatal) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  }
}

/**
 * Get the current trace context for propagation
 * Returns traceparent header value for W3C Trace Context
 */
export function getTraceContext(): { traceId: string; spanId: string; traceparent: string } | null {
  const span = trace.getActiveSpan();
  if (!span) return null;

  const ctx = span.spanContext();
  if (!ctx.traceId || ctx.traceId === '00000000000000000000000000000000') {
    return null;
  }

  const traceparent = `00-${ctx.traceId}-${ctx.spanId}-01`;
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    traceparent,
  };
}

/**
 * Create a child span from a traceparent header
 * Used for continuing traces from WebSocket messages
 */
export function createSpanFromTraceparent(
  name: string,
  traceparent: string | undefined,
): Span | null {
  if (!traceparent) {
    return tracer.startSpan(name);
  }

  // Parse W3C traceparent: 00-traceId-spanId-flags
  const parts = traceparent.split('-');
  if (parts.length !== 4) {
    return tracer.startSpan(name);
  }

  const [_version, traceId, spanId, flags] = parts;
  const spanContext: SpanContext = {
    traceId,
    spanId,
    traceFlags: parseInt(flags, 16),
    isRemote: true,
  };

  const parentContext = trace.setSpanContext(context.active(), spanContext);
  return tracer.startSpan(name, {}, parentContext);
}

/**
 * Generate a new trace ID for a WebSocket message
 * Returns both the trace ID and traceparent header
 */
export function generateTraceId(): { traceId: string; traceparent: string } {
  // Use crypto for secure random trace ID
  const traceIdBytes = new Uint8Array(16);
  const spanIdBytes = new Uint8Array(8);
  crypto.getRandomValues(traceIdBytes);
  crypto.getRandomValues(spanIdBytes);

  const traceId = Array.from(traceIdBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const spanId = Array.from(spanIdBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    traceId,
    traceparent: `00-${traceId}-${spanId}-01`,
  };
}

// Export types for consumers
export { Span, SpanStatusCode } from '@opentelemetry/api';
