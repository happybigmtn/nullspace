# Mobile Vault QA Runbook

This runbook validates the non-custodial vault fallback on real devices.

## Devices
- iOS (latest + one previous major)
- Android (latest + one previous major)

## Preconditions
- Gateway running with stable rate limits.
- Simulator running with faucet enabled.
- Mobile app pointed at gateway (`ws://<LAN-IP>:9010`).

## Checklist
### Passkey vault (where supported)
- Create passkey vault.
- Confirm `session_ready` and balance available within 5s.
- Start a game, complete, and see payout.
- Lock + unlock vault; confirm signing resumes.
- Delete vault; confirm key reset and no legacy keys remain.

### Password vault fallback (all devices)
- Create password vault with recovery key.
- Enforce password min length 10 (PBKDF2-SHA256, 310k iterations).
- Export recovery key; store out-of-band.
- Lock app, relaunch, unlock with password.
- Import recovery key on a second device; confirm key matches (public key).

Notes:
- Passkey vaults are device-bound; migrating to a new device requires
  passkey sync in the OS or a password vault recovery key.

### Failure modes
- Enter wrong password 3 times; confirm no lockout and clear error messaging.
- Background app for 30s; confirm reconnect + state restore.
- Toggle airplane mode mid-game; confirm reconnect and no crash.

## Success criteria
- No crashes during vault create/unlock/import.
- Signing fails gracefully when vault locked.
- Recovery flow restores the correct public key.
