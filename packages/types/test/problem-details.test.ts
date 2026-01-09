/**
 * RFC 7807 Problem Details Tests (US-227)
 *
 * Tests for the Problem Details implementation per RFC 7807/9457.
 */
import { describe, it, expect } from 'vitest';
import {
  type ProblemDetails,
  PROBLEM_JSON_CONTENT_TYPE,
  ProblemTypes,
  createProblemDetails,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  rateLimited,
  internalError,
  serviceUnavailable,
} from '../src/problem-details.js';

describe('RFC 7807 Problem Details (US-227)', () => {
  describe('PROBLEM_JSON_CONTENT_TYPE', () => {
    it('should be the correct media type', () => {
      expect(PROBLEM_JSON_CONTENT_TYPE).toBe('application/problem+json');
    });
  });

  describe('ProblemTypes', () => {
    it('should define standard problem type URNs', () => {
      expect(ProblemTypes.BAD_REQUEST).toBe('urn:nullspace:problem:bad-request');
      expect(ProblemTypes.UNAUTHORIZED).toBe('urn:nullspace:problem:unauthorized');
      expect(ProblemTypes.FORBIDDEN).toBe('urn:nullspace:problem:forbidden');
      expect(ProblemTypes.NOT_FOUND).toBe('urn:nullspace:problem:not-found');
      expect(ProblemTypes.RATE_LIMITED).toBe('urn:nullspace:problem:rate-limited');
      expect(ProblemTypes.VALIDATION_ERROR).toBe('urn:nullspace:problem:validation-error');
    });

    it('should define auth-specific problem types', () => {
      expect(ProblemTypes.CSRF_INVALID).toBe('urn:nullspace:problem:csrf-invalid');
      expect(ProblemTypes.ORIGIN_NOT_ALLOWED).toBe('urn:nullspace:problem:origin-not-allowed');
      expect(ProblemTypes.SESSION_EXPIRED).toBe('urn:nullspace:problem:session-expired');
    });

    it('should define server error problem types', () => {
      expect(ProblemTypes.INTERNAL_ERROR).toBe('urn:nullspace:problem:internal-error');
      expect(ProblemTypes.SERVICE_UNAVAILABLE).toBe('urn:nullspace:problem:service-unavailable');
    });
  });

  describe('createProblemDetails', () => {
    it('should create a minimal problem details object', () => {
      const problem = createProblemDetails(400, 'Bad Request');

      expect(problem.type).toBe('about:blank');
      expect(problem.title).toBe('Bad Request');
      expect(problem.status).toBe(400);
      expect(problem.detail).toBeUndefined();
      expect(problem.instance).toBeUndefined();
    });

    it('should include optional fields when provided', () => {
      const problem = createProblemDetails(400, 'Bad Request', {
        type: ProblemTypes.VALIDATION_ERROR,
        detail: 'The publicKey field is invalid',
        instance: '/request/abc-123',
      });

      expect(problem.type).toBe(ProblemTypes.VALIDATION_ERROR);
      expect(problem.title).toBe('Bad Request');
      expect(problem.status).toBe(400);
      expect(problem.detail).toBe('The publicKey field is invalid');
      expect(problem.instance).toBe('/request/abc-123');
    });

    it('should support extension fields', () => {
      const problem = createProblemDetails(429, 'Too Many Requests', {
        type: ProblemTypes.RATE_LIMITED,
        detail: 'Rate limit exceeded',
        retryAfter: 60,
        limit: 100,
        remaining: 0,
      });

      expect(problem.status).toBe(429);
      expect((problem as any).retryAfter).toBe(60);
      expect((problem as any).limit).toBe(100);
      expect((problem as any).remaining).toBe(0);
    });
  });

  describe('helper functions', () => {
    describe('badRequest', () => {
      it('should create a 400 Bad Request problem', () => {
        const problem = badRequest('Invalid input');

        expect(problem.type).toBe(ProblemTypes.BAD_REQUEST);
        expect(problem.title).toBe('Bad Request');
        expect(problem.status).toBe(400);
        expect(problem.detail).toBe('Invalid input');
      });
    });

    describe('unauthorized', () => {
      it('should create a 401 Unauthorized problem', () => {
        const problem = unauthorized('Missing or invalid token');

        expect(problem.type).toBe(ProblemTypes.UNAUTHORIZED);
        expect(problem.title).toBe('Unauthorized');
        expect(problem.status).toBe(401);
        expect(problem.detail).toBe('Missing or invalid token');
      });
    });

    describe('forbidden', () => {
      it('should create a 403 Forbidden problem', () => {
        const problem = forbidden('Access denied');

        expect(problem.type).toBe(ProblemTypes.FORBIDDEN);
        expect(problem.title).toBe('Forbidden');
        expect(problem.status).toBe(403);
        expect(problem.detail).toBe('Access denied');
      });
    });

    describe('notFound', () => {
      it('should create a 404 Not Found problem', () => {
        const problem = notFound('Resource not found');

        expect(problem.type).toBe(ProblemTypes.NOT_FOUND);
        expect(problem.title).toBe('Not Found');
        expect(problem.status).toBe(404);
        expect(problem.detail).toBe('Resource not found');
      });
    });

    describe('rateLimited', () => {
      it('should create a 429 Too Many Requests problem with retryAfter', () => {
        const problem = rateLimited(60);

        expect(problem.type).toBe(ProblemTypes.RATE_LIMITED);
        expect(problem.title).toBe('Too Many Requests');
        expect(problem.status).toBe(429);
        expect(problem.detail).toBe('Rate limit exceeded. Retry after 60 seconds.');
        expect((problem as any).retryAfter).toBe(60);
      });

      it('should create a 429 problem without retryAfter', () => {
        const problem = rateLimited();

        expect(problem.status).toBe(429);
        expect(problem.detail).toBe('Rate limit exceeded.');
        expect((problem as any).retryAfter).toBeUndefined();
      });
    });

    describe('internalError', () => {
      it('should create a 500 Internal Server Error problem', () => {
        const problem = internalError('Something went wrong');

        expect(problem.type).toBe(ProblemTypes.INTERNAL_ERROR);
        expect(problem.title).toBe('Internal Server Error');
        expect(problem.status).toBe(500);
        expect(problem.detail).toBe('Something went wrong');
      });
    });

    describe('serviceUnavailable', () => {
      it('should create a 503 Service Unavailable problem', () => {
        const problem = serviceUnavailable('Service is temporarily unavailable');

        expect(problem.type).toBe(ProblemTypes.SERVICE_UNAVAILABLE);
        expect(problem.title).toBe('Service Unavailable');
        expect(problem.status).toBe(503);
        expect(problem.detail).toBe('Service is temporarily unavailable');
      });
    });
  });

  describe('RFC 7807 compliance', () => {
    it('should produce a valid RFC 7807 response structure', () => {
      const problem = createProblemDetails(400, 'Bad Request', {
        type: ProblemTypes.VALIDATION_ERROR,
        detail: 'The request body is invalid',
        instance: '/request/12345',
      });

      // RFC 7807 mandates these fields
      expect(problem).toHaveProperty('type');
      expect(problem).toHaveProperty('title');
      expect(problem).toHaveProperty('status');

      // Type must be a string (URI reference)
      expect(typeof problem.type).toBe('string');

      // Title must be a string
      expect(typeof problem.title).toBe('string');

      // Status must be a number
      expect(typeof problem.status).toBe('number');
    });

    it('should default type to about:blank when not provided', () => {
      const problem = createProblemDetails(500, 'Internal Server Error');

      // RFC 7807 §3.1: "about:blank" is the default
      expect(problem.type).toBe('about:blank');
    });

    it('should not include undefined optional fields', () => {
      const problem = createProblemDetails(400, 'Bad Request');

      // Optional fields should not be present if not provided
      expect('detail' in problem).toBe(false);
      expect('instance' in problem).toBe(false);
    });

    it('should be serializable to JSON', () => {
      const problem = createProblemDetails(400, 'Bad Request', {
        type: ProblemTypes.VALIDATION_ERROR,
        detail: 'Invalid input',
        customField: 'custom value',
      });

      const json = JSON.stringify(problem);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe(ProblemTypes.VALIDATION_ERROR);
      expect(parsed.title).toBe('Bad Request');
      expect(parsed.status).toBe(400);
      expect(parsed.detail).toBe('Invalid input');
      expect(parsed.customField).toBe('custom value');
    });
  });
});
