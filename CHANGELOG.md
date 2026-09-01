# Changelog

All notable changes to DSH Computer Use are recorded here. The project follows semantic versioning after `1.0.0`; before then, minor releases may change model-facing and provider behavior.

## [Unreleased]

### Added

- Added host-configurable Agent-cursor maximum speed, acceleration/deceleration, and post-arrival click delay, with natural human-readable defaults and high-throughput ranges in Web Settings.

### Changed

- The Agent cursor now appears only over the current frontmost target application, follows a slightly curved acceleration-shaped path from its previous point, and completes native movement before click or drag press feedback and input are delivered.
- Existing 0.2.x `cursorMotionMs` values remain accepted during upgrade but no longer control runtime movement; the physical speed, acceleration, and click-delay defaults replace the fixed duration.

## [0.2.1] - 2026-09-01

### Fixed

- Increased the persistent Agent cursor response deadline from 120 milliseconds to one second so synchronous WindowServer validation can complete under normal system load, while preserving fail-closed process-generation discard after a genuine timeout.

## [0.2.0] - 2026-09-01

### Added

- Added opaque observation-local target handles with deterministic exact-locator, macOS `AXIdentifier`, and unique semantic resolution; successful element actions now report resolution mode, confidence, candidate count, and target-change metadata.
- Added a Codex-aligned, click-through Agent cursor overlay that animates independently from the macOS system cursor, remains nonactivating, binds to the exact observed window, and can be configured or hidden from Web Settings.
- Added `AXPress` descendant retry for `click`: when a target advertises `AXPress` but macOS rejects it, the helper retries pressable descendants within a bounded depth before falling back to coordinates.
- Added host-owned `interaction.focusPolicy` and `interaction.pointerInputPolicy` settings with default `preserve` / `targeted` behavior and matching Web Settings controls.
- Added `allowAllApps` configuration and Web Settings switch for granting `read` and `control` to every running app without per-bundle-id grants.
- Added `interaction.keyboardPolicy` (`preserve` / `activate`, Bundle default `activate`) so `type-text` keyboard fallback and `press-key` can reliably activate the target app before input, matching Codex Computer Use.
- Added `coordinateSpace: screen` for click, scroll, and drag; the helper resolves the topmost on-screen window of the selected app under the point, so arbitrary screen coordinates work without a unique observed window id.
- Added target-process pointer delivery for click, scroll, and drag, bound to the exact pid, `CGWindowID`, and window-local point through dynamically resolved SkyLight APIs.
- Added action-result evidence through `activation`, `pointerInput`, and `pointerRouting`.
- Added a bilingual foreground-safe input design record and release checks for forbidden global pointer primitives.
- Added a detached-process and parent-transport guard that rejects ordinary direct helper invocation before command parsing.

### Fixed

- Made Agent cursor visibility failures explicit from the native overlay through the Tool result, serialized the persistent cursor protocol, and discarded timed-out or malformed process generations so late responses cannot satisfy later commands.
- Reported bounded structural action evidence as `effect.observedStateChanged`, serialized same-app actions through post-action observation, and stopped treating pixel-only or external effects as proven failures.
- Reported missing stable window ids instead of silently skipping the Agent cursor, and required exact or decorated-title evidence when owner/frame matching leaves multiple window candidates.
- Fixed non-macOS profile startup failure: the plugin now degrades gracefully on unsupported platforms, keeps the profile running, leaves Computer Use Tools and the Skill unregistered, and reports `COMPUTER_UNSUPPORTED_PLATFORM` in Web Settings instead of throwing during Bundle construction.
- Invalidated one-use confirmation when a sensitive target requires rebinding, and added fail-closed ambiguity/low-confidence errors instead of selecting a similar element.
- Directed screenshot OCR, visual grounding, and pixel inspection to the installed `vision-tools` Skill and native Vision Toolkit tools at both the Computer Use Skill and screenshot Artifact decision points, instead of allowing shell-built OCR substitutes.
- Moved Session-wide read grants and rejected app/scope decisions out of unofficial Session event types into the plugin-owned `computer_use_state` storage-domain sidecar, fenced to the exact Session lifecycle and persisted after the Session audit flush.
- Removed global HID pointer posting and system-cursor movement from the native helper.
- Fixed `AXPress` clicks failing on container elements that advertise `AXPress` but reject the press even though a pressable child exists (for example App Store sidebar cells).
- Removed unconditional target-app activation from semantic Accessibility actions and process-targeted input.
- Added exact CoreGraphics window-id resolution when Accessibility omits `AXWindowNumber`; ambiguous or missing window identity now fails closed.
- Relaxed post-activation validation for keyboard actions: activation may move focus to the app's default control, so typing targets the refreshed focused element instead of requiring full pre-activation state equality.
- Prevented duplicate target clicks by using one SkyLight delivery route instead of posting the same pointer event through two APIs.
- Treated `approval/policy: never` as a policy block instead of a user rejection: ungranted apps fail with an actionable message, no denial is recorded, and sensitive confirmation is refused without an ask.
- Applied persisted Settings grants at startup so `settings.yaml` grants take effect without a prior Settings write.

### Verification

- Added resolver unit coverage and a native fixture case that inserts an unrelated sibling, recreates a stable checkbox, proves the old child-index locator fails, and verifies `AXIdentifier` rebinding.
- The deterministic fixture now starts through `open -g` in background mode, records target activation, and probes click, scroll, and drag delivery without taking the foreground.
- Added a native millisecond-sampling monitor that requires the system cursor and frontmost pid to remain unchanged throughout every target-process pointer action.
- Clean Profile and real-model lanes now require the fixture to remain never-active on the default route.
- Added a native fixture case that clicks an arbitrary Quartz screen coordinate without an observed window id and asserts the target-process route.
- Added a native fixture case that proves `keyboardPolicy: activate` brings a background fixture forward and delivers the key event.

### Changed

- Changed the default `observationTtlMs` to `0` (observation expiry disabled); a finite TTL up to 86400000 ms (24 hours) remains configurable.
- Changed the default `interaction.cursorAutoHideMs` to `0`: the Agent cursor stays at the action position until the bound window changes or a hide command; a finite auto-hide remains configurable.

### Documentation

- Documented the npm package name as `@anionex/dsh-computer-use`: the former `@dsh-external/dsh-computer-use` name was never published to npm, so downstream profiles must reference the current name.
- Reworked the public repository facade around non-interfering target-process input, the fresh-observation protocol, deterministic native proof, permissions, security, support, and contribution paths.
- Added a reusable native-integrity command and structured community intake.
- Documented the Codex Computer Use alignment evidence (`SynthesizedEvent.send(to: pid)` and `CGWindow.window(at:)`) behind the screen-coordinate and keyboard-policy behavior.

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
