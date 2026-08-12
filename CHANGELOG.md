# Changelog

All notable changes to DSH Computer Use are recorded here. The project follows semantic versioning after `1.0.0`; before then, minor releases may change model-facing and provider behavior.

## [Unreleased]

### Added

- Added a Codex-aligned, click-through Agent cursor overlay that animates independently from the macOS system cursor, remains nonactivating, binds to the exact observed window, and can be configured or hidden from Web Settings.
- Added host-owned `interaction.focusPolicy` and `interaction.pointerInputPolicy` settings with default `preserve` / `targeted` behavior and matching Web Settings controls.
- Added target-process pointer delivery for click, scroll, and drag, bound to the exact pid, `CGWindowID`, and window-local point through dynamically resolved SkyLight APIs.
- Added action-result evidence through `activation`, `pointerInput`, and `pointerRouting`.
- Added a bilingual foreground-safe input design record and release checks for forbidden global pointer primitives.
- Added a detached-process and parent-transport guard that rejects ordinary direct helper invocation before command parsing.

### Fixed

- Removed global HID pointer posting and system-cursor movement from the native helper.
- Removed unconditional target-app activation from semantic Accessibility actions and process-targeted input.
- Added exact CoreGraphics window-id resolution when Accessibility omits `AXWindowNumber`; ambiguous or missing window identity now fails closed.
- Prevented duplicate target clicks by using one SkyLight delivery route instead of posting the same pointer event through two APIs.
- Treated `approval/policy: never` as a policy block instead of a user rejection: ungranted apps fail with an actionable message, no denial is recorded, and sensitive confirmation is refused without an ask.
- Applied persisted Settings grants at startup so `settings.yaml` grants take effect without a prior Settings write.

### Verification

- The deterministic fixture now starts through `open -g` in background mode, records target activation, and probes click, scroll, and drag delivery without taking the foreground.
- Added a native millisecond-sampling monitor that requires the system cursor and frontmost pid to remain unchanged throughout every target-process pointer action.
- Clean Profile and real-model lanes now require the fixture to remain never-active on the default route.

### Documentation

- Reworked the public repository facade around non-interfering target-process input, the fresh-observation protocol, deterministic native proof, permissions, security, support, and contribution paths.
- Added a reusable native-integrity command and structured community intake.

## [0.1.0] - 2026-08-11

### Added

- Accessibility-first macOS Computer Use Service, provider, Skill, and progressively exposed Tool vocabulary.
- Exact application selection, full/diff observations, stale-state rejection, bounded settlement, and fresh post-action results.
- Read/control application leases plus one-use sensitive-action confirmation.
- Workspace-fenced screenshot Artifacts and secure-field redaction.
- Universal `arm64` + `x86_64` native helper with pinned source digest, SHA-256, deployment target, and code signature.
- Web Settings integration for helper health, limits, TCC status, and exact application grants.
- Deterministic AppKit fixture covering native action channels, stale rejection, redaction, teardown, and clean Web/Headless Profile lifecycle.

### Fixed

- Made frozen standalone pnpm installation reproducible by committing workspace peer-install policy.
