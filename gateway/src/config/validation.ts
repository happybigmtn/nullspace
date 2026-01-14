/**
 * Configuration Validation
 *
 * Validates environment configuration at startup to prevent production
 * deployments with placeholder or insecure values.
 */

export interface ConfigValidationError {
  key: string;
  value: string;
  reason: string;
}

/**
 * Known placeholder strings that indicate unconfigured credentials
 */
const PLACEHOLDER_PATTERNS = [
  'your_github_oauth_app_client_id_here',
  'your_github_oauth_app_client_secret_here',
  'your_google_oauth_app_client_id_here',
  'your_google_oauth_app_client_secret_here',
  'your_twitter_api_key_here',
  'your_twitter_api_secret_here',
  'your_secure_metrics_token_here',
  'placeholder',
  'changeme',
  'default',
  'example',
  'test_',
  'demo_',
] as const;

/**
 * Environment variables that must not contain placeholder values in production
 */
const CRITICAL_ENV_VARS = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET',
  'METRICS_AUTH_TOKEN',
  'JWT_SECRET',
  'SESSION_SECRET',
] as const;

/**
 * Check if a value appears to be a placeholder
 */
function isPlaceholder(value: string): boolean {
  const lowerValue = value.toLowerCase().trim();

  if (lowerValue === '') {
    return true;
  }

  if (/your_.*_here/.test(lowerValue)) {
    return true;
  }

  return PLACEHOLDER_PATTERNS.some(pattern => lowerValue.includes(pattern.toLowerCase()));
}

/**
 * Validate configuration for production deployment
 *
 * @throws Error if critical configuration issues are found
 */
export function validateProductionConfig(): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  const isProduction = process.env.NODE_ENV === 'production';

  // Only enforce strict validation in production
  if (!isProduction) {
    return errors;
  }

  // Check critical environment variables
  for (const key of CRITICAL_ENV_VARS) {
    const value = process.env[key];

    // Skip if not set (optional credentials)
    if (!value) {
      continue;
    }

    // Check for placeholder values
    if (isPlaceholder(value)) {
      errors.push({
        key,
        value: value.slice(0, 20) + '...', // Truncate for security
        reason: 'Contains placeholder value. Set real credentials before production deployment.',
      });
    }

    // Check for obviously insecure values
    if (value.length < 8 && key.includes('SECRET')) {
      errors.push({
        key,
        value: '[REDACTED]',
        reason: 'Secret is too short (< 8 characters). Use a strong, randomly generated value.',
      });
    }
  }

  // Validate GATEWAY_ALLOWED_ORIGINS
  const allowedOrigins = process.env.GATEWAY_ALLOWED_ORIGINS?.trim();
  if (!allowedOrigins || allowedOrigins === '') {
    errors.push({
      key: 'GATEWAY_ALLOWED_ORIGINS',
      value: '[EMPTY]',
      reason: 'Must be set in production. Use comma-separated list of allowed origins (e.g., https://app.nullspace.io)',
    });
  } else {
    // Validate each origin
    const origins = allowedOrigins.split(',').map((o) => o.trim()).filter(Boolean);
    for (const origin of origins) {
      try {
        const url = new URL(origin);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          errors.push({
            key: 'GATEWAY_ALLOWED_ORIGINS',
            value: origin,
            reason: `Invalid protocol "${url.protocol}". Use http: or https:.`,
          });
        }
      } catch {
        errors.push({
          key: 'GATEWAY_ALLOWED_ORIGINS',
          value: origin,
          reason: 'Invalid URL format. Must be a valid origin (e.g., https://example.com)',
        });
      }
    }
  }

  // Validate METRICS_AUTH_TOKEN if set
  const metricsToken = process.env.METRICS_AUTH_TOKEN;
  if (metricsToken && isPlaceholder(metricsToken)) {
    errors.push({
      key: 'METRICS_AUTH_TOKEN',
      value: '[REDACTED]',
      reason: 'Contains placeholder value. Generate a secure random token for metrics authentication.',
    });
  }

  return errors;
}

/**
 * Validate configuration and throw if errors are found
 *
 * @throws Error with detailed validation failure message
 */
export function validateProductionConfigOrThrow(): void {
  const errors = validateProductionConfig();

  if (errors.length > 0) {
    const errorMessages = errors
      .map((err, idx) => `${idx + 1}. ${err.key}: ${err.reason}\n   Value: ${err.value}`)
      .join('\n\n');

    throw new Error(
      `Configuration validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}):\n\n${errorMessages}\n\nFix these issues before deploying to production.`,
    );
  }
}

/**
 * Log warnings for configuration issues in development
 */
export function validateDevelopmentConfig(): void {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  if (!isDevelopment) return;

  const warnings: string[] = [];

  // Warn about missing optional credentials
  const optionalCreds = [
    'GITHUB_CLIENT_ID',
    'GOOGLE_CLIENT_ID',
    'TWITTER_API_KEY',
  ] as const;

  for (const key of optionalCreds) {
    if (!process.env[key]) {
      warnings.push(`${key} not set - OAuth provider will be unavailable`);
    }
  }

  if (warnings.length > 0) {
    console.warn('[Config] Development warnings:');
    warnings.forEach((w) => console.warn(`  - ${w}`));
  }
}
