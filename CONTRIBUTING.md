# Contributing to DSH Computer Use

Thank you for improving the native action layer for DeepSeek Harness. Changes must preserve exact target identity, fresh observations, scoped permissions, bounded native input, and reconstructable post-action state.

## Before starting

- Read [README.md](README.md), especially the protocol, permissions, native integrity, security, and limitation sections.
- Prefer a browser, API, shell, or existing domain Tool when it exposes a narrower and more reliable interface.
- Search existing issues before proposing overlapping work.
- Use [SECURITY.md](SECURITY.md) instead of a public issue for suspected vulnerabilities.
- Use the deterministic fixture rather than a private application whenever possible.

## Development layout

The repository consumes exact DSH peer declarations from a sibling DeepSeek Harness checkout:

```text
workspace/
├── packages/
├── vendor/
└── dsh-computer-use/
```

Use macOS 14 or newer, Node.js `^22.19.0` or `>=24.0.0`, and pnpm `11.20.0`:

```sh
pnpm install --frozen-lockfile
pnpm run build
DSH_COMPUTER_USE_REQUIRE_TCC=1 pnpm test
pnpm pack --dry-run
pnpm run validate
```

The TCC-required test lane needs Accessibility and Screen Recording permission for the active terminal or Agent host. `pnpm run validate` is the keyless release runner; maintainers also run `pnpm run validate:model` with a real DeepSeek credential before publication.

## Change requirements

- Bind every action to an exact app, pid, observation, window, and selected element or observed-window coordinate.
- Reject stale or ambiguous targets. Do not search for a visually or textually similar replacement.
- Prefer advertised Accessibility actions and values over coordinate or keyboard fallback.
- Preserve the user's current frontmost application by default. Host configuration, not model arguments, owns activation and pointer policy.
- Route coordinate input only to the exact referenced pid and observed window; never add a system-cursor warp or global HID pointer-post fallback.
- Fail closed when the exact `CGWindowID`, window frame, or target-process pointer route is unavailable or ambiguous.
- After an explicitly permitted activation, observe and validate the exact target again before emitting input.
- Keep the native cursor/frontmost monitor in the TCC-required lane; static symbol checks do not replace behavior-level non-interference evidence.
- Preserve secure-field redaction and minimize screenshot, tree, Tool-result, and diagnostic disclosure.
- Keep read and control leases scoped; configured grants must not bypass sensitive-action confirmation.
- Validate every deployment-varying limit in configuration.
- Keep Tool schemas finite and progressively exposed after the Skill is loaded.
- Update committed `lib/`, Web client, and native manifest/binary when their sources change.
- Keep `README.md` and `README.zh.md` synchronized in section order, commands, links, and claims.

## Native helper changes

The helper protocol accepts fixed structured commands only. Do not add arbitrary AppleScript, JXA, shell, Swift, Objective-C, selectors, Accessibility constants, or source-code execution.

After changing Swift sources:

```sh
pnpm run native:build
pnpm run check:native
DSH_COMPUTER_USE_REQUIRE_TCC=1 pnpm exec vitest run tests/native-helper.spec.ts tests/native-fixture.e2e.spec.ts
```

Inspect the updated manifest, architectures, deployment target, code signature, and binary diff before committing.

## Tests and evidence

Match evidence to the changed surface:

- observation, lease, confirmation, and lifecycle rules: focused Service tests;
- native protocol or input: static global-input rejection plus real never-active fixture behavior and stale rejection;
- Web Settings: browser-safe snapshot, write validation, generation replacement, and client build checks;
- package changes: package-layout tests and `pnpm pack --dry-run`;
- DSH composition: clean Web and Headless Profile install/disable/re-enable/remove;
- model-visible changes: real Agent transcript evidence in addition to unit tests.

Do not include screenshots, bundle ids, Accessibility trees, or logs from private applications in a contribution.

## Pull requests

Explain the user-visible problem first, identify the narrower interfaces considered, and include exact commands and outcomes. Call out permission, confirmation, stale-state, data-handling, and teardown implications. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
