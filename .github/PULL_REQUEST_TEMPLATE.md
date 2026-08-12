## Summary

Describe the user-visible problem and why native Computer Use is the correct capability rather than a browser, API, shell, or domain-specific Tool.

## Evidence

- [ ] Added or updated focused tests.
- [ ] Exercised the deterministic native fixture when behavior reaches the helper or application UI.
- [ ] Ran the documented build, package, and validation commands that cover this change.
- [ ] Updated English and Chinese README content together when public behavior changed.
- [ ] Kept generated `lib/`, Web client, native manifest, and binary inputs synchronized where applicable.

## Protocol and safety checks

- [ ] Actions remain bound to an exact app, process, observation, window, and target.
- [ ] Stale or ambiguous state fails closed instead of selecting a similar target.
- [ ] Accessibility actions remain preferred over coordinates.
- [ ] Coordinate input remains pid/window-targeted, with no system-cursor warp or global HID pointer-post fallback.
- [ ] The default path remains never-active in the deterministic fixture.
- [ ] Read/control leases and sensitive-action confirmation were considered.
- [ ] Secure values, screenshots, error messages, and diagnostics do not disclose unnecessary data.
- [ ] Teardown aborts helper work and releases observations, confirmations, routes, and registrations.

## Packaging

- [ ] No credentials, private screenshots, local absolute dependencies, or machine-specific temporary files are included.
- [ ] The helper is a regular file with the expected source digest, SHA-256, architectures, deployment target, and code signature.
- [ ] `pnpm pack --dry-run` includes all required runtime, source, native, client, patch, documentation, and license files.

## Commands run

```text
# Paste exact commands and results.
```
