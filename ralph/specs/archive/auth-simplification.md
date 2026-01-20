# Auth Service Simplification

## Overview
Reduce auth-service runtime complexity by removing billing/Stripe, EVM linking, and AI proxy endpoints. Keep the minimal session/auth flows required for gameplay.

## Acceptance Criteria

### AC-1: Billing/Stripe Removal
- **AC-1.1**: Stripe webhook, checkout, and billing endpoints are removed or return 404.
- **AC-1.2**: Auth service starts without Stripe-related environment variables.

### AC-2: EVM Linking Removal
- **AC-2.1**: EVM address linking endpoints are removed or return 404.
- **AC-2.2**: Auth service starts without EVM-related environment variables.

### AC-3: AI Proxy Removal
- **AC-3.1**: AI proxy endpoints are removed or return 404.
- **AC-3.2**: Auth service starts without AI-related environment variables.

### AC-4: Core Auth Intact
- **AC-4.1**: Session authentication, token issuance, and core auth flows continue to function.
- **AC-4.2**: Auth service startup remains stable with only core configuration.

## Technical Details
- Remove Stripe/EVM/AI routes and handlers from `services/auth/src/server.ts`.
- Prune unused dependencies from `services/auth/package.json`.
- Remove or gate Convex actions that are only used by billing/EVM features.
- Update website calls so no client requests removed endpoints.

## Examples
- `POST /profile/link-evm` returns 404.
- `POST /stripe/webhook` returns 404.
- `POST /ai/strategy` returns 404.
