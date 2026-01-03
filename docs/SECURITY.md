# Reporting Security Issues

We welcome security disclosures and are committed to prompt attention for confirmed issues.

Please report vulnerabilities privately:
- GitHub Security: https://github.com/commonwarexyz/nullspace/security/advisories
- Email: security@nullspace.xyz

We do not currently offer a public bounty program. We may provide discretionary rewards for
critical issues and will credit reporters with permission.

## Operational security checklist
- Never log private keys, admin keys, or service tokens (redact on error paths).
- Prefer file/secret-backed keys in production (env keys only for non-prod).
- Rotate service tokens (Convex, ops) at least every 90 days, after personnel changes,
  and immediately after any suspected leak. Keep a rotation log and overlap new/old
  tokens for <24 hours before revoking the old one.
