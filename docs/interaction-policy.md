# Foreground-safe input policy

## Requirement

DSH Computer Use must let an Agent operate a native macOS application while the user continues working elsewhere. The default path must not move the system cursor, post pointer events to the global HID stream, or activate the target application merely to make an action work.

The default Bundle configuration is:

```yaml
interaction:
  focusPolicy: preserve
  pointerInputPolicy: targeted
```

`preserve` means the helper does not request foreground activation. `targeted` means mouse, drag, and wheel events may be sent only to the exact observed process and window. The model cannot change either policy through Tool arguments.

This is an input-routing property, not a consequence of Accessibility permission alone. Accessibility grants semantic UI access; foreground preservation comes from choosing semantic Accessibility operations first and using process/window-targeted fallback instead of the system cursor.

## Overall design

The action path has four ordered layers:

1. The DSH Service binds the request to one unexpired observation, exact bundle id, pid, window, and element or window-relative point.
2. The native helper observes the target again and rejects changed or ambiguous state.
3. The helper prefers `AXPress`, Accessibility value assignment, selected-text assignment, or an action advertised by the element.
4. When semantic input is unavailable, keyboard events are posted to the selected pid and pointer events are posted to the selected pid and window. No pointer fallback uses a global event tap.

Pointer delivery resolves the exact `CGWindowID`, converts the screen point to window-local coordinates, annotates the event with the target pid/window fields, and posts it through `SLEventPostToPid`. Missing window identity, unavailable SkyLight symbols, or an ambiguous window match fails closed.

Policy is enforced twice on the supported DSH Tool path. The Service rejects a known pointer or foreground requirement before obtaining a control lease or consuming a sensitive-action confirmation. The helper validates the same resolved policy immediately before input, including fallback decisions that can only be made at runtime. The helper also requires an isolated process group plus three standard pipe or Unix-socket transports whose peer endpoints belong to its direct parent process; ordinary shell redirection fails closed before any command is parsed. This transport check is defense in depth, not authentication against arbitrary code running as the same macOS user: a deliberately constructed detached parent can reproduce the topology, especially under `danger-full-access`. The registered Tool path remains the only supported route because it applies leases, confirmations, and host policy before invoking the helper.

Every action result reports the route actually used:

```ts
activation: 'not-requested' | 'already-frontmost' | 'activated'
pointerInput: boolean
pointerRouting: 'none' | 'target-process'
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
| `type-text` keyboard fallback | None | Target pid | Allowed; target compatibility varies |
| `press-key` | None | Target pid | Allowed; target compatibility varies |
| coordinate click or element-frame fallback | None | Target pid + window | Allowed when `pointerInputPolicy: targeted` |
| scroll | None | Target pid + window | Allowed when `pointerInputPolicy: targeted` |
| drag | None | Target pid + window | Allowed when `pointerInputPolicy: targeted` |

`pointerInputPolicy: deny` disables coordinate click/fallback, scroll, and drag while leaving semantic Accessibility and process-targeted keyboard paths available.

## Critical decisions

### Host policy is not a Tool argument

The deployment owns `focusPolicy` and `pointerInputPolicy`. `allowCoordinateFallback` says only that `computer_click` may try the host-authorized pointer route after `AXPress` is unavailable. It cannot enable pointer delivery or foreground activation. `computer_perform_action` also treats `AXRaise` as foreground-affecting and rejects it under `preserve`.

### Accessibility remains the primary route

Semantic Accessibility operations are more stable than pixels and need no cursor emulation. They also work against many background applications. The helper revalidates the exact target before invoking them and reports `activation: not-requested`, `pointerInput: false`, and `pointerRouting: none`.

### The default pointer route is virtual and target-specific

The helper never moves the system cursor and then tries to restore it. That design would still interrupt the user, race with real input, and risk delivering an event to the wrong application.

Instead, pointer fallback creates an event at the observed screen point, binds it to the exact pid and `CGWindowID`, supplies the window-local point expected by AppKit, and sends it through the per-process SkyLight route. Click, scroll, and drag share this route. The committed helper contains no `CGWarpMouseCursorPosition`, global `CGEventPost`, or `.post(tap: .cghidEventTap)` path.

### Activation is an explicit compatibility mode

Some applications accept input only while active. A deployment may set `focusPolicy: activate`, accepting that the target application can take the foreground. Before emitting input, the helper activates the exact process, observes it again, and revalidates the referenced window and element. Any state change fails with `COMPUTER_STALE_OBSERVATION` instead of acting on the pre-activation target.

The default `preserve` policy never performs this activation step.

### Pointer delivery fails closed

Target-process pointer delivery needs an exact on-screen window id and frame. If Accessibility does not expose `AXWindowNumber`, the helper searches the CoreGraphics window list by pid, frame, and title and accepts only one match. It does not guess among multiple windows or fall back to the global cursor.

### Private SPI is isolated and optional at runtime

The per-process pointer route uses dynamically resolved SkyLight symbols. This keeps the failure explicit on an unsupported macOS build: semantic Accessibility and process-targeted keyboard input remain available, while pointer fallback returns `COMPUTER_ACTION_BLOCKED`. The helper never silently changes to global pointer injection.

## Verified evidence

The release evidence covers both implementation and observed behavior:

- source and binary checks reject system-cursor warp symbols, the exact global `CGEventPost` symbol, and unknown dynamically resolved native symbols;
- the helper must contain `SLEventPostToPid` and `CGEventSetWindowLocation`;
- the fixture is started through `open -g` with `--background`, so LaunchServices does not request foreground activation;
- the fixture records every `applicationDidBecomeActive` callback and requires `activationCount: 0` on the default path;
- an independent native monitor samples cursor position and the frontmost pid every millisecond throughout click, scroll, and drag; every sample must remain unchanged;
- background `AXPress`, Accessibility value/action, selected-text input, and pid-targeted key input change the fixture without activating it;
- target-process click and scroll are each observed exactly once; drag has exactly one down/up gesture; the target remains non-frontmost;
- `pointerInputPolicy: deny` rejects click fallback, scroll, and drag before any target pointer event is delivered;
- clean Profile and real-model validation require the model-visible action result and fixture transcript to agree.

## Known limitations

- Target-process pointer delivery is less universal than semantic Accessibility. Custom canvases, games, hardened input surfaces, or future macOS changes may reject it.
- The window must be on-screen and uniquely identifiable. Minimized, fully hidden, ambiguous, or windowless targets fail closed.
- `focusPolicy: activate` is intentionally disruptive and exists only as an operator-selected compatibility mode.
- A target application may change its own activation or focus as a side effect of an accepted action; the helper does not claim control over application-internal behavior.
