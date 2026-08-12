# Security Policy

## Supported versions

Security fixes target the latest commit on `main`. Version `0.1.x` is pre-stable; older commits do not receive a separate maintenance guarantee.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Email `davidyang042@gmail.com` with the subject `dsh-computer-use security report`. Include the affected commit or version, impact, minimal reproduction, target application class, and any suggested mitigation. Do not send credentials, unrelated screenshots, secure-field contents, or customer data. Reports are handled privately while the issue is investigated and a fix or disclosure plan is prepared.

## Security-relevant behavior

The following properties are intentional and a regression in them is security-relevant:

- every native action remains bound to an exact application, pid, observation, window, and element or observed-window coordinate;
- stale, replaced, expired, or ambiguous state fails closed without guessing a target;
- the default `preserve` policy does not request target-app activation; any explicit `activate` compatibility mode re-observes and revalidates before input;
- pointer fallback is bound to the exact pid, `CGWindowID`, and observed-window coordinates; the helper has no system-cursor warp or global HID pointer-post route;
- missing, ambiguous, or unavailable target-process pointer routing fails closed instead of falling back to the global cursor;
- secure-field values are redacted from trees, Tool results, metadata, and native errors;
- screenshots are workspace-fenced, size-bounded Artifacts and are captured only when requested;
- read and control leases remain scoped to the exact Agent and bundle id, with control bounded to the current turn;
- sensitive actions require a short-lived one-use confirmation that configured grants cannot bypass;
- the helper accepts only the fixed JSON protocol and never arbitrary scripts, selectors, native constants, or source code;
- the helper's detached-process and parent-transport check rejects ordinary shell redirection, but is defense in depth rather than authentication against deliberately constructed same-user code; `danger-full-access` is outside that protection;
- managed helper identity, source digest, SHA-256, architectures, deployment target, and code signature are checked;
- disabling or removing the plugin aborts helper work and releases observations, confirmations, routes, and registrations.

## Scope

Reports about the DeepSeek Harness approval or sandbox implementation, a target application's own Accessibility exposure, or another composed plugin should be sent to that project's security channel unless DSH Computer Use is required to reproduce the issue. General permission and setup questions belong in [SUPPORT.md](SUPPORT.md).
