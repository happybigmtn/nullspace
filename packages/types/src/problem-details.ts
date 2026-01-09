/**
 * RFC 7807 / RFC 9457 Problem Details for HTTP APIs
 *
 * @see https://www.rfc-editor.org/rfc/rfc9457.html
 */

/**
 * Standard problem details object per RFC 7807/9457.
 *
 * Consumers MUST ignore extensions they don't recognize.
 */
export interface ProblemDetails {
  /**
   * URI reference identifying the problem type.
   * SHOULD be a stable URL to documentation or a URN.
   * Defaults to "about:blank" if omitted.
   */
  type?: string;

  /**
   * Short, human-readable summary of the problem type.
   * SHOULD be the same for all occurrences of this type.
   */
  title: string;

  /**
   * HTTP status code for this occurrence.
   * Conveniently makes the response self-contained.
   */
  status: number;

  /**
   * Human-readable explanation specific to this occurrence.
   * Clients SHOULD NOT parse this for structured data - use extensions instead.
   */
  detail?: string;

  /**
   * URI reference identifying this specific occurrence.
   * Typically includes a request ID or trace ID.
   */
  instance?: string;
}

/**
 * Problem Details with custom extension fields.
 * Use this when you need to include additional problem-specific data.
 */
export type ProblemDetailsWithExtensions<T extends Record<string, unknown> = Record<string, unknown>> =
  ProblemDetails & T;

/**
 * Media type for RFC 7807 Problem Details responses.
 */
export const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';

/**
 * Standard problem type URNs for common HTTP errors.
 * Using URNs instead of URLs since we don't have public documentation hosted.
 */
export const ProblemTypes = {
  // Client errors (4xx)
  BAD_REQUEST: 'urn:nullspace:problem:bad-request',
  UNAUTHORIZED: 'urn:nullspace:problem:unauthorized',
  FORBIDDEN: 'urn:nullspace:problem:forbidden',
  NOT_FOUND: 'urn:nullspace:problem:not-found',
  RATE_LIMITED: 'urn:nullspace:problem:rate-limited',
  VALIDATION_ERROR: 'urn:nullspace:problem:validation-error',

  // Auth-specific
  CSRF_INVALID: 'urn:nullspace:problem:csrf-invalid',
  ORIGIN_NOT_ALLOWED: 'urn:nullspace:problem:origin-not-allowed',
  SESSION_EXPIRED: 'urn:nullspace:problem:session-expired',

  // Billing
  BILLING_DISABLED: 'urn:nullspace:problem:billing-disabled',

  // Server errors (5xx)
  INTERNAL_ERROR: 'urn:nullspace:problem:internal-error',
  SERVICE_UNAVAILABLE: 'urn:nullspace:problem:service-unavailable',
} as const;

export type ProblemType = (typeof ProblemTypes)[keyof typeof ProblemTypes];

/**
 * Helper to create a Problem Details response object.
 *
 * @param status - HTTP status code
 * @param title - Human-readable problem type summary
 * @param options - Additional fields (type, detail, instance, extensions)
 * @returns ProblemDetails object ready to be serialized as JSON
 */
export function createProblemDetails<T extends Record<string, unknown> = Record<string, never>>(
  status: number,
  title: string,
  options?: {
    type?: string;
    detail?: string;
    instance?: string;
  } & T
): ProblemDetailsWithExtensions<T> {
  const { type, detail, instance, ...extensions } = options ?? {};

  return {
    type: type ?? 'about:blank',
    title,
    status,
    ...(detail !== undefined && { detail }),
    ...(instance !== undefined && { instance }),
    ...extensions,
  } as ProblemDetailsWithExtensions<T>;
}

/**
 * Create a 400 Bad Request problem.
 */
export function badRequest(
  detail?: string,
  extensions?: Record<string, unknown>
): ProblemDetails {
  return createProblemDetails(400, 'Bad Request', {
    type: ProblemTypes.BAD_REQUEST,
    detail,
    ...extensions,
  });
}

/**
 * Create a 401 Unauthorized problem.
 */
export function unauthorized(
  detail?: string,
  extensions?: Record<string, unknown>
): ProblemDetails {
  return createProblemDetails(401, 'Unauthorized', {
    type: ProblemTypes.UNAUTHORIZED,
    detail,
    ...extensions,
  });
}

/**
 * Create a 403 Forbidden problem.
 */
export function forbidden(
  detail?: string,
  extensions?: Record<string, unknown>
): ProblemDetails {
  return createProblemDetails(403, 'Forbidden', {
    type: ProblemTypes.FORBIDDEN,
    detail,
    ...extensions,
  });
}

/**
 * Create a 404 Not Found problem.
 */
export function notFound(
  detail?: string,
  extensions?: Record<string, unknown>
): ProblemDetails {
  return createProblemDetails(404, 'Not Found', {
    type: ProblemTypes.NOT_FOUND,
    detail,
    ...extensions,
  });
}

/**
 * Create a 429 Too Many Requests problem.
 */
export function rateLimited(
  retryAfter?: number,
  extensions?: Record<string, unknown>
): ProblemDetails {
  return createProblemDetails(429, 'Too Many Requests', {
    type: ProblemTypes.RATE_LIMITED,
    detail: retryAfter ? `Rate limit exceeded. Retry after ${retryAfter} seconds.` : 'Rate limit exceeded.',
    ...(retryAfter !== undefined && { retryAfter }),
    ...extensions,
  });
}

/**
 * Create a 500 Internal Server Error problem.
 */
export function internalError(
  detail?: string,
  extensions?: Record<string, unknown>
): ProblemDetails {
  return createProblemDetails(500, 'Internal Server Error', {
    type: ProblemTypes.INTERNAL_ERROR,
    detail,
    ...extensions,
  });
}

/**
 * Create a 503 Service Unavailable problem.
 */
export function serviceUnavailable(
  detail?: string,
  extensions?: Record<string, unknown>
): ProblemDetails {
  return createProblemDetails(503, 'Service Unavailable', {
    type: ProblemTypes.SERVICE_UNAVAILABLE,
    detail,
    ...extensions,
  });
}
