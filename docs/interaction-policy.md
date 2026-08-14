# Foreground-safe input policy

## Requirement

DSH Computer Use must let an Agent operate a native macOS application while the user continues working elsewhere. The default pointer path must not move the system cursor, post pointer events to the global HID stream, or activate the target application merely to make a pointer action work. Keyboard input is the one deliberate exception: the Bundle enables `keyboardPolicy: activate` so typing works reliably by bringing the target app to the foreground first, matching Codex Computer Use behavior. Pointer actions may show a separate Agent cursor, but that overlay must never become an input source or a window manager participant.

The default Bundle configuration is:

```yaml
interaction:
  focusPolicy: preserve
  keyboardPolicy: activate
  pointerInputPolicy: targeted
  cursorVisualization: visible
  cursorMotionMs: 180
  cursorAutoHideMs: 0
```

`preserve` means pointer actions do not request foreground activation. `keyboardPolicy: activate` (the Bundle default) requests foreground activation before `type-text` keyboard fallback and `press-key`; `keyboardPolicy: preserve` keeps typing routed to the selected pid without activation and is reliable only for applications that accept background keyboard events. `targeted` means mouse, drag, and wheel events may be sent only to the exact observed process and window. `visible` enables the separate Agent cursor, whose motion and auto-hide timing are also host-owned. The model cannot change any interaction policy through Tool arguments.

This is an input-routing property, not a consequence of Accessibility permission alone. Accessibility grants semantic UI access; foreground preservation comes from choosing semantic Accessibility operations first and using process/window-targeted fallback instead of the system cursor.

## Overall design

The action path has five ordered layers:

1. The DSH Service binds the request to one unexpired observation, exact bundle id, pid, window, and element target handle, compatibility index, window-relative point, or screen-global point.
2. For a handle action, the Service obtains fresh Accessibility state and resolves the target through the original locator, one unique provider-native identifier, or one unique semantic role/name/actions/ancestor match. Application, process, and selected-window identity remain exact; ambiguity and low confidence fail closed.
3. The native helper observes the resolved target again and rejects any race that changed its locator, properties, process, or window before input.
4. The helper prefers `AXPress`, Accessibility value assignment, selected-text assignment, or an action advertised by the element. When a `click` target advertises `AXPress` but macOS rejects the press, the helper retries `AXPress` on the element's pressable descendants within a bounded depth before considering the element-frame or coordinate pointer route.
5. When semantic input is unavailable, keyboard events are posted to the selected pid and pointer events are posted to the selected pid and window. No pointer fallback uses a global event tap.

Pointer delivery uses the observed window when it contains the point; otherwise it resolves the topmost on-screen window of the selected app that contains the screen point and posts through `SLEventPostToPid` with the pid/window fields and window-local coordinates. This is the same target-process shape Codex Computer Use uses (`SynthesizedEvent.send(to: pid)` with `CGWindow.window(at:)`), so `coordinateSpace: screen` supports arbitrary-coordinate clicks without a global HID event stream. Unavailable SkyLight symbols or a point outside every window of the selected app fails closed.

Visual feedback uses a 28x28 `NSPanel` owned by a dedicated, persistent cursor process. The panel is borderless, nonactivating, click-through, and excluded from normal window cycling; it is not made visible on every Space. It draws the embedded transparent whole-image cursor (`assets/cursor.png`, Cursor arrow plus DeepSeek whale) with its top-left corner at the target point. Before input it animates to the same screen-global target point using an ease-out motion, briefly compresses the image for click, and keeps it pressed through a drag. By default it stays at the target point until the bound window changes or a hide command; set `cursorAutoHideMs` to a finite value for inactivity auto-hide. The overlay never posts input and never changes the system cursor position.

Policy is enforced twice on the supported DSH Tool path. The Service rejects a known pointer or foreground requirement before obtaining a control lease or consuming a sensitive-action confirmation. The helper validates the same resolved policy immediately before input, including fallback decisions that can only be made at runtime. The helper also requires an isolated process group plus three standard pipe or Unix-socket transports whose peer endpoints belong to its direct parent process; ordinary shell redirection fails closed before any command is parsed. This transport check is defense in depth, not authentication against arbitrary code running as the same macOS user: a deliberately constructed detached parent can reproduce the topology, especially under `danger-full-access`. The registered Tool path remains the only supported route because it applies leases, confirmations, and host policy before invoking the helper.

Every action result reports the route actually used:

```ts
activation: 'not-requested' | 'already-frontmost' | 'activated'
pointerInput: boolean
pointerRouting: 'none' | 'target-process'
resolution?: {
  mode: 'exact-locator' | 'native-identifier' | 'semantic-rebind'
  confidence: number
  candidateCount: number
  targetChanged: boolean
}
```

These fields do not claim that a target application can never change focus as its own side effect. They report only what the helper requested and emitted.

## Action matrix

| Action path | Default activation | Pointer route | Default result |
|---|---|---|---|
| `click` through `AXPress` | None | None | Allowed |
| `set-value` through Accessibility | None | None | Allowed |
| non-foreground `perform-action` advertised by the element | None | None | Allowed |
| `AXRaise` | Denied | None | Requires explicit `focusPolicy: activate`, then re-observation/revalidation |
| `type-text` through selected-text assignment | None | None | Allowed when the focused element accepts it |
| `type-text` keyboard fallback | None with `keyboardPolicy: preserve`; `activated` with `keyboardPolicy: activate` | Target pid | Allowed; activation makes it reliable |
| `press-key` | None with `keyboardPolicy: preserve`; `activated` with `keyboardPolicy: activate` | Target pid | Allowed; activation makes it reliable |
| coordinate click or element-frame fallback | None | Target pid + window | Allowed when `pointerInputPolicy: targeted` |
| scroll | None | Target pid + window | Allowed when `pointerInputPolicy: targeted` |
| drag | None | Target pid + window | Allowed when `pointerInputPolicy: targeted` |

`pointerInputPolicy: deny` disables coordinate click/fallback, scroll, and drag while leaving semantic Accessibility and process-targeted keyboard paths available. `coordinateSpace: window` (default) resolves coordinates inside the observed window frame; `coordinateSpace: screen` accepts Quartz screen-global points.

## Critical decisions

### Host policy is not a Tool argument

The deployment owns `focusPolicy`, `keyboardPolicy`, and `pointerInputPolicy`. `allowCoordinateFallback` says only that `computer_click` may try the host-authorized pointer route after `AXPress` is unavailable. It cannot enable pointer delivery or foreground activation. `computer_perform_action` also treats `AXRaise` as foreground-affecting and rejects it under `preserve`.

### Accessibility remains the primary route

Semantic Accessibility operations are more stable than pixels and need no cursor emulation. They also work against many background applications. The helper revalidates the exact target before invoking them and reports `activation: not-requested`, `pointerInput: false`, and `pointerRouting: none`.

### Stable handles rebind only with independent identity evidence

The public `targetHandle` is opaque and observation-local; it does not expose an `AXUIElement`, locator, or `AXIdentifier`. The Service stores the normalized descriptor in Agent-owned memory and re-observes immediately before a handle action. Exact locator identity is preferred. Rebinding is opt-in through `allowRebind` and requires either one provider-native identifier whose stable semantics still match or one semantic candidate with the same role, normalized accessible name, advertised actions, and stable ancestor fingerprint. The resolver preserves the exact bundle id, pid, and selected-window identity. A truncated tree cannot authorize rebinding. Duplicate candidates return `COMPUTER_TARGET_AMBIGUOUS`; missing or insufficient evidence returns `COMPUTER_TARGET_LOW_CONFIDENCE`.

Sensitive confirmation is bound to the exact handle action. Any native-identifier or semantic fallback marks the target changed, invalidates the prior token, and returns `COMPUTER_TARGET_REBIND_REQUIRES_CONFIRMATION` before input. Coordinates and screenshot-derived boxes cannot become handles, identity evidence, or authorization for a sensitive target. The caller must select the current handle and obtain a new one-use confirmation. Provider-native visual hit-testing remains a separate follow-up because the current visual workflow cannot independently validate a screenshot coordinate.

### The default pointer route is virtual and target-specific

The helper never moves the system cursor and then tries to restore it. That design would still interrupt the user, race with real input, and risk delivering an event to the wrong application.

Instead, pointer fallback creates an event at the target screen point, binds it to the exact pid and `CGWindowID` (the observed window when it contains the point, otherwise the topmost app window under the point), supplies the window-local point expected by AppKit, and sends it through the per-process SkyLight route. Click, scroll, and drag share this route. The committed helper contains no `CGWarpMouseCursorPosition`, global `CGEventPost`, or `.post(tap: .cghidEventTap)` path.

### Cursor visualization is presentation-only

The visible Agent cursor is deliberately not the input source. It is a separate process with a strict JSON-lines protocol and a startup-ready handshake. Every show, press, and release is bound to the observed pid, `CGWindowID`, and expected frame; a closed, moved, resized, minimized, or off-screen window hides the overlay. Because presentation is separate from routing, disabling the cursor cannot change action semantics and overlay failure cannot redirect or globally emit input.

### Activation is an explicit compatibility mode

Some applications accept input only while active. A deployment may set `focusPolicy: activate` (all actions) or `keyboardPolicy: activate` (keyboard actions only), accepting that the target application can take the foreground. Before emitting input, the helper activates the exact process and observes it again. Element and window targets are revalidated; for keyboard actions the refreshed focused element is the target, because activation may move focus to the app's default control. Any element/window mismatch fails with `COMPUTER_STALE_OBSERVATION` instead of acting on the pre-activation target.

With `focusPolicy: preserve` and `keyboardPolicy: preserve`, the helper never performs this activation step.

### Pointer delivery fails closed

Target-process pointer delivery resolves the window from the point itself: the observed window is used when its frame contains the point; otherwise the helper takes the topmost on-screen window of the selected app whose frame contains the point. Observation still captures `AXWindowNumber` when available and falls back to a unique frame/title match, but coordinate actions no longer require that match. A point outside every on-screen window of the selected app fails closed instead of falling back to the global cursor.

### Private SPI is isolated and optional at runtime

The per-process pointer route uses dynamically resolved SkyLight symbols. This keeps the failure explicit on an unsupported macOS build: semantic Accessibility and process-targeted keyboard input remain available, while pointer fallback returns `COMPUTER_ACTION_BLOCKED`. The helper never silently changes to global pointer injection.

## Verified evidence

The release evidence covers both implementation and observed behavior:

- source and binary checks reject system-cursor warp symbols, the exact global `CGEventPost` symbol, and unknown dynamically resolved native symbols;
- overlay checks require a nonactivating panel, click-through hit testing, prohibited application activation policy, and no cursor-warp primitive;
- the overlay runtime rejects missing or malformed target identity, oversized or invalid JSON-lines commands, unsupported timing, and direct helpers that do not own a managed parent transport;
- a real overlay process must emit its ready frame before commands, reuse one process across commands, and stop cleanly on disposal;
- a native monitor requires the overlay to be the only 28x28 window owned by its process, not become frontmost, and produce no global pointer events from that process pid;
- the helper must contain `SLEventPostToPid` and `CGEventSetWindowLocation`;
- a coordinate click without an observed window id resolves the app window under the Quartz screen point and still reports `pointerRouting: target-process`;
- `keyboardPolicy: activate` makes a background fixture become active and receive the key event, and the fixture transcript records the activation;
- the fixture is started through `open -g` with `--background`, so LaunchServices does not request foreground activation;
- the fixture records every `applicationDidBecomeActive` callback and the default path must not increase `activationCount`;
- an independent native monitor samples cursor position and the frontmost pid every millisecond throughout click, scroll, and drag; every sample must remain unchanged;
- background `AXPress`, Accessibility value/action, selected-text input, and pid-targeted key input change the fixture without activating it;
- the native fixture inserts a harmless sibling and recreates a uniquely identified checkbox, proving the raw locator becomes stale while `AXIdentifier` resolution still finds exactly one target;
- target-process click and scroll are each observed exactly once; drag has exactly one down/up gesture; the target remains non-frontmost;
- `pointerInputPolicy: deny` rejects click fallback, scroll, and drag before any target pointer event is delivered;
- clean Profile and real-model validation require the model-visible action result and fixture transcript to agree.

## Known limitations

- Target-process pointer delivery is less universal than semantic Accessibility. Custom canvases, games, hardened input surfaces, or future macOS changes may reject it.
- The clicked point must fall inside an on-screen window of the selected app; minimized, fully hidden, or windowless targets fail closed.
- `focusPolicy: activate` and `keyboardPolicy: activate` are intentionally disruptive and exist only as operator-selected compatibility modes.
- A target application may change its own activation or focus as a side effect of an accepted action; the helper does not claim control over application-internal behavior.
- The Agent cursor is scoped to one active Space and the exact observed window. `cursorAutoHideMs: 0` keeps it visible until the bound window changes, a new hide command arrives, or the helper is disposed.
- Stable handles currently use exact locators, provider-native identifiers, and strict semantic identity. Semantic-spatial rebinding and provider-native visual hit-testing remain follow-up work; a vision-derived coordinate alone is never a verified target.
