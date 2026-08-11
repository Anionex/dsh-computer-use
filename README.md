# DSH Computer Use

**DSH Computer Use is an Accessibility-first macOS action layer for DeepSeek Harness. It lets an Agent inspect and operate native applications through fresh, replayable observations instead of unscoped coordinate clicks or arbitrary desktop scripts.**

English | [中文](README.zh.md)

## Why this exists

Shell tools can launch an application and browser tools can operate a web page, but neither exposes a general native macOS UI protocol. A useful desktop Agent needs more than `click(x, y)`: it must identify the exact running application, read current UI structure, bind an action to that state, reject stale targets, obtain scoped access, and return what the application looks like after the action.

This package fills that action-layer gap without becoming another Agent runtime. It contributes one DSH Service, one native macOS provider, one portable Skill, progressively exposed model Tools, screenshot Artifacts, and a Web Settings section. Domain bundles such as `dsh-design` can compose it when a task crosses into a native application, while browser and API tasks keep using narrower capabilities.

## Product position

```text
dsh-vision-toolkit   visual facts, OCR, grounding, and pixel evidence
dsh-computer-use     native application observation and bounded UI actions
dsh-design           domain decisions and design completion criteria
```

DSH Computer Use is the reusable **action layer**. It does not implement a vision model, a design workflow, a browser protocol, a remote-desktop stream, or a replacement desktop shell.

## Core protocol

```text
select exact app
-> acquire read access
-> observe Accessibility state and optional screenshot
-> choose an element or observed-window coordinate
-> acquire control access
-> act against that exact observation
-> wait for bounded settlement
-> receive a fresh post-action observation
```

Every element index belongs to one opaque `observationId`. A modifying Tool requires that ID, and the native provider rebuilds current UI state before sending input. Element actions reject a changed process, window, locator, or target identity while tolerating unrelated tree updates; coordinate and focus-dependent actions require the full observed state to remain current. A stale operation fails with `COMPUTER_STALE_OBSERVATION` and never guesses an equivalent element.

## Platform and prerequisites

- macOS 14 or newer.
- DeepSeek Harness with Web or Headless Profile support.
- Node.js `^22.19.0` or `>=24.0.0`.
- macOS Accessibility permission for structural observation and UI actions.
- macOS Screen Recording permission only when screenshots are requested.

The committed helper is an ad-hoc-signed universal `arm64` + `x86_64` binary. Its SHA-256, source digest, architectures, and minimum macOS version are pinned in `native/macos/manifest.json`; source is included under `native/macos/Sources/Helper/`.

## Quick start

Clone the repository, add the Bundle to the Profiles that should expose it, and inspect the assembled configuration:

```sh
git clone https://github.com/dsh-external/dsh-computer-use.git
PLUGIN="$PWD/dsh-computer-use"

dsh plugin --profile web add "$PLUGIN"
dsh plugin --profile headless add "$PLUGIN"

dsh --profile web --dump-config
dsh --profile headless --dump-config
```

In a Session with `tool-skill`, load the Skill:

```text
/computer-use
```

The Skill result activates the execution schemas only for that Agent. `computer_use_activate` remains as a small recovery bootstrap and disappears from that Agent after activation.

A suitable first request is:

> Use Computer Use to inspect the running DSH Computer Use Fixture, enable its deterministic option, and report the fresh status. Prefer Accessibility elements and do not reuse an old observation.

## macOS permissions

The Web Settings section reports helper integrity, Accessibility status, Screen Recording status, active generation, limits, and per-application grants. Its buttons can open the exact macOS privacy pane after a user click; the plugin never grants TCC permissions itself.

If a permission is missing:

1. Open DSH Settings → Computer Use.
2. Use **Open macOS Settings** for Accessibility or Screen Recording.
3. Grant permission to the process identity macOS reports for the active DSH host/helper launch path.
4. Restart the affected host if macOS requires it, then use **Refresh health**.

Accessibility is required for `computer_observe` and all native actions. Screen Recording is optional for `screenshot: "optional"` and mandatory for `screenshot: "required"`.

These TCC grants are UI permissions, not filesystem permissions. Normal use
runs under DSH's `workspace-write` policy: screenshot Artifacts stay in the
Session workspace, transient plugin files use Session-private temporary
storage, and the Bundle does not require `danger-full-access`.

## Model Tools

The deployment initially contributes only `computer_use_activate`. After the Agent loads `computer-use`, it receives these focused Tools:

| Tool | Purpose |
|---|---|
| `computer_list_apps` | List bounded, user-facing running applications with bundle id, pid, frontmost state, and permission diagnostics. |
| `computer_observe` | Return a fresh full/diff Accessibility observation and optional screenshot Artifact. |
| `computer_click` | Prefer `AXPress`; optionally click an observed element frame or observed-window coordinate. |
| `computer_set_value` | Set an editable Accessibility value, including clearing it, without using the clipboard. |
| `computer_type_text` | Insert Unicode into the currently focused control through Accessibility when supported, with a CoreGraphics fallback; never read or replace the clipboard. |
| `computer_press_key` | Send one key from the documented finite vocabulary with optional command/control/option/shift modifiers. |
| `computer_scroll` | Send bounded directional scrolling at an observed element or coordinate. |
| `computer_drag` | Drag between two points in the referenced observation's window coordinate space. |
| `computer_perform_action` | Execute one exact Accessibility action advertised by the selected element. |
| `computer_wait` | Poll one bounded text/role/title condition and return fresh state without modifying the app. |
| `computer_confirm` | Obtain a one-use approval token bound to one exact sensitive action. |

There is no Tool accepting AppleScript, JXA, shell, Swift, Objective-C, native selectors, arbitrary Accessibility constants, or source code.

## Observation model

An observation contains:

- opaque `observationId`, creation time, and expiry;
- exact application `bundleId`, current `pid`, and display name;
- frontmost and current-window metadata;
- bounded Accessibility tree text;
- current element rows with role, title/label, redacted value, state, frame, and advertised actions;
- optional screenshot Artifact with dimensions and file metadata;
- Accessibility and Screen Recording state.

The first observation for an Agent/application pair is full. Later observations may return a diff whose indexes always refer to the newly returned state. Request `full: true` when prior context was compacted or a complete tree is needed.

Secure text fields are emitted as `[secure]`; their values never enter the tree, Tool result, screenshot metadata, or native error. Screenshots can still contain other visible application data, so read access remains application-scoped.

## Application access and sensitive confirmation

The technical access model has two leases:

- **read**: inspect Accessibility state and a requested screenshot;
- **control**: send UI input to the selected application.

Without a configured grant, the plugin asks through DSH approval. Read approval lasts the Session; control approval lasts the current turn. Both are scoped to the exact Agent and bundle id. Headless execution without an approval answerer fails closed.

Some actions also need semantic confirmation immediately before execution: high-impact external communication, transmission of sensitive data, irreversible deletion, account/security/privacy changes, unrequested installation, legal acceptance, or financial completion beyond the user's explicit authorization. `computer_confirm` returns a short-lived token bound to the exact app, process, observation, and action fields. A mismatch, expiry, or second use is rejected.

Configured grants do not bypass sensitive-action confirmation.

Before sending any input, the provider revalidates the referenced target, requests activation of the selected process, and waits up to `actionTimeoutMs` for that application to become frontmost. Keyboard fallbacks are posted to that exact process id; coordinate input is emitted only after the foreground check. If activation does not complete, the action fails with `COMPUTER_ACTION_BLOCKED` without emitting input.

## Configuration

Configuration belongs to the aggregate `computer-use` Bundle row. That row initializes the macOS Service provider before publishing the Skill and Agent-scoped Tools. All deployment-varying limits are validated and can also be changed through the live Web Settings provider.

```yaml
- id: computer-use
  config:
    observationTtlMs: 15000
    confirmationTtlMs: 300000
    actionTimeoutMs: 15000
    settleMs: 250
    maxSettleMs: 5000
    maxNodes: 500
    maxDepth: 14
    maxTextBytes: 64000
    maxScreenshotBytes: 33554432
    artifactRoot: .dsh-computer-use/artifacts
    helper:
      allowSourceBuild: false
    grants:
      - bundleId: com.example.Editor
        read: true
        control: false
```

| Field | Meaning |
|---|---|
| `observationTtlMs` | Lifetime of an observation ID, `1000`–`120000`. |
| `confirmationTtlMs` | Lifetime of an unused one-action token, `1000`–`900000`. |
| `actionTimeoutMs` | Hard native helper call and target-app activation timeout, `1000`–`120000`. |
| `settleMs` | Delay between post-action state checks, `0`–`10000`. |
| `maxSettleMs` | Maximum post-action settlement/wait budget, `100`–`60000`. |
| `maxNodes` / `maxDepth` / `maxTextBytes` | Bounds for Accessibility traversal and model-visible text. |
| `maxScreenshotBytes` | Maximum accepted PNG Artifact size. |
| `artifactRoot` | Workspace-relative, non-escaping screenshot directory. |
| `helper.path` | Optional explicit external helper executable. |
| `helper.allowSourceBuild` | Allow an explicit managed-source rebuild when the committed helper is absent. Default `false`. |
| `grants` | Exact non-wildcard bundle-id read/control policy. `control: true` implies read. |

An external helper path must be an executable regular file, not a symbolic link. The managed helper must match the committed manifest hash. Package archives may remove its execute bit; after verifying the regular-file identity and manifest hash, the provider restores only the owner's execute permission before launch.

## Web and Headless behavior

- **Web:** adds a `dsh.client` Settings section for health, limits, helper selection, and exact bundle-id grants. Tool output uses generic cards and screenshot Artifact metadata; there is no continuous desktop stream.
- **Headless:** exposes the same Skill, Tools, observation semantics, errors, and artifacts. Missing interactive approval returns a stable permission/confirmation failure instead of silently allowing control.

Settings updates are generation-based. A candidate helper/config must pass validation and health before replacing the active generation; replacement invalidates old observations and pending confirmations.

## Stable error codes

| Code | Correct next step |
|---|---|
| `COMPUTER_UNSUPPORTED_PLATFORM` | Use a supported provider or another capability. |
| `COMPUTER_PERMISSION_REQUIRED` | Grant the named macOS permission or DSH application lease. |
| `COMPUTER_APP_NOT_FOUND` | List apps and select an exact bundle id and pid. |
| `COMPUTER_STALE_OBSERVATION` | Observe again and reselect the target. |
| `COMPUTER_ELEMENT_UNAVAILABLE` | Use an advertised action or an explicit coordinate fallback. |
| `COMPUTER_TARGET_UNAVAILABLE` | Use a narrower capability, visual grounding, or ask the user. |
| `COMPUTER_CONFIRMATION_REQUIRED` | Confirm the exact proposed action immediately before executing it. |
| `COMPUTER_ACTION_BLOCKED` | Inspect fresh state and choose another supported action. |
| `COMPUTER_TIMEOUT` | Inspect current state; retry only when doing so is safe. |
| `COMPUTER_CANCELLED` | Stop or reassess the task. |
| `COMPUTER_PROVIDER_FAILURE` | Inspect bounded diagnostics; do not infer that the action succeeded. |

## Development and verification

The repository is expected to live next to a DeepSeek Harness checkout so its TypeScript compiler can consume the exact peer API declarations.

```sh
pnpm install
pnpm run build
DSH_COMPUTER_USE_REQUIRE_TCC=1 pnpm test
pnpm pack --dry-run
node scripts/validate.mjs --lane all
pnpm run validate:model
```

`pnpm run build` compiles and ad-hoc signs a universal helper, builds the deterministic fixture application, emits ESM runtime/types, and produces the loader-compatible Web client. The native fixture test performs real application discovery, Accessibility observation, screenshot capture, AX click/value/action, Unicode typing, key input, scrolling, dragging, delayed state, stale rejection, secure-field redaction, and process termination.

The release runner also checks committed `lib/`, native hashes and architectures, tarball contents, DSH plugin validation, clean Web/Headless Profile installation, progressive exposure, disable/re-enable/remove behavior, and a real fixture workflow through DSH's model Tool protocol under `workspace-write`. `pnpm run validate:model` installs a fresh tarball, launches the deterministic native fixture, and requires a real DeepSeek model to discover, observe, and operate it through the focused Computer Use Tools; it requires `DEEPSEEK_API_KEY` and accepts an optional `DEEPSEEK_BASE_URL`. `pnpm run validate:release` runs both validation layers. Publication requires both to pass before any push.

## Scope and limitations

- P0 is macOS-only. No Windows UI Automation or Linux provider is claimed.
- Accessibility quality depends on the target application. Some custom canvases expose incomplete structure and require screenshot/vision fallback.
- Browser tasks should continue to use browser automation because DOM/CDP state is narrower and more precise.
- The package captures discrete requested observations, not a live desktop feed.
- Coordinate actions are constrained to a referenced observed window; they are still less reliable than Accessibility actions.
- Application leases establish technical access, not business-impact classification. The Skill and one-use confirmation protocol handle the latter.
- The helper does not persist native element pointers. Every action reconstructs current state and verifies its hash.

## Removal

```sh
dsh plugin --profile web remove @dsh-external/dsh-computer-use
dsh plugin --profile headless remove @dsh-external/dsh-computer-use
```

Removing or disabling the Bundle unregisters the Skill and Tools, aborts in-flight helper work, releases Agent observations and confirmations, removes the Web route/client contribution, and leaves generated screenshot files in the Session workspace for explicit user cleanup.

## License

MIT. See [LICENSE](LICENSE).
