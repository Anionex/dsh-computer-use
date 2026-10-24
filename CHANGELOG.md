# Changelog

## Unreleased

- Support DSH `0.2.1-rc.3`: extend every DSH peer range and the declared compatibility matrix, and move the development baseline to `0.2.1-rc.3`. DSH rejects a plugin whose exact prerelease peers do not name the running release, so `0.2.1-rc.2` alone made the plugin show as incompatible and drop out of the profile after that update.
- 支持 DSH `0.2.1-rc.3`：扩展全部 DSH peer 范围与兼容性声明，并把开发基线升级到 `0.2.1-rc.3`。DSH 要求精确的预发布 peer 必须包含当前运行的版本，只声明 `0.2.1-rc.2` 会让插件在升级后显示为不兼容并从 profile 中掉出。
- Capture windows without ScreenCaptureKit's default shadow framing, which drew the window content inset and scaled inside an image that already had the window frame's pixel size. Screenshot pixels are now a direct `pixelScale` rendering of the window frame, and the helper fails closed when the captured dimensions do not match it.
- Add a `screenshot` coordinate space for coordinate actions, so a coordinate read off a screenshot can be passed without dividing by the pixel scale by hand. `computer_observe` reports `screenshot.pixelScale` (pixels per window point), the service converts screenshot pixels to window points before the Agent cursor and native input run, and validates the provider scale against the captured dimensions. Window coordinates that exceed the window frame but fit the screenshot now fail with an error naming the scale and the correct space, instead of clicking at the wrong offset.
- Mint sensitive-action confirmation tokens over the normalized action, so a confirmed `coordinateSpace: 'screenshot'` action executes instead of failing the one-use token match.
- Enable Chromium's `AXManualAccessibility` when an observed app publishes a sparse tree, so Electron applications such as DSH expose their window content (buttons, rows, text fields) to Accessibility instead of forcing screenshot-coordinate clicks. The wait is bounded and happens once per app launch.
- Retry a Chromium Accessibility press that reported success while changing neither the Accessibility tree nor focus, using one target-process pointer click at the element center instead of returning a phantom success. Native apps keep the ordinary press path.
- Click elements inside Chromium web content with target-process pointer input at the element center: Chromium accepts `AXPress` there and activates nothing, so the previous path reported success without clicking anything. Native controls keep the Accessibility press path; hosts that deny pointer input fail closed instead of reporting a phantom click.
- 捕获窗口时关闭 ScreenCaptureKit 默认的阴影取景：此前窗口内容会在与 frame 像素尺寸相同的图像中被内缩并缩放，截图像素无法线性映射到窗口 point。现在截图是窗口 frame 的直接 `pixelScale` 渲染，捕获尺寸不匹配时 helper 会 fail closed。
- 新增 `screenshot` 坐标空间：从截图上读到的坐标可以直接传入，无需手动除以像素倍率。`computer_observe` 返回 `screenshot.pixelScale`（每个窗口 point 对应的像素数），Service 在 Agent 光标与 native 输入之前把截图像素换算为窗口 point，并用 provider 倍率校验截图尺寸。window 坐标超出窗口 frame 但落在截图范围内时，会报错说明倍率与应使用的坐标空间，而不是偏移后点到错误位置。
- 敏感动作的确认 token 改为绑定归一化后的 action，已确认的 `coordinateSpace: 'screenshot'` 动作不再因 token 哈希不匹配而失败。
- 观察到的 app 若 AX 树过于稀疏，会启用 Chromium 的 `AXManualAccessibility`，让 Electron 应用（如 DSH）把窗口内容（按钮、列表行、输入框）暴露给 Accessibility，不再只能靠截图坐标点击。等待有上限，且每次 app 启动只发生一次。
- Chromium 上 Accessibility press 报告成功、但 AX 树与焦点都没有变化时，改用元素中心的一次 target-process 指针点击重试，而不是返回幽灵成功。原生应用仍走普通 press 路径。
- Chromium web 内容里的元素改为以 element 中心做 target-process 指针点击：Chromium 会接受这里的 `AXPress` 却不触发任何动作，旧路径因此会“报告成功但什么都没点”。原生控件仍走 Accessibility press 路径；禁用指针输入的主机会失败关闭，而不是报告一次幽灵点击。

## 0.3.4 — 2026-10-18

- Support DSH `0.2.1-rc.2`: extend every DSH peer range and the declared compatibility matrix, and move the development baseline to `0.2.1-rc.2` (cordis `4.0.5`, schemastery `3.18.5`).
- 支持 DSH `0.2.1-rc.2`：扩展全部 DSH peer 范围与兼容性声明，并把开发基线升级到 `0.2.1-rc.2`（cordis `4.0.5`、schemastery `3.18.5`）。
- Rebuild the universal macOS helper as 0.3.4 and keep its source, signature, manifest, and package version synchronized. Pin pnpm release-age exceptions to the exact host dependency versions.
- 将通用 macOS helper 重建为 0.3.4，同步源码、签名、清单及软件包版本；pnpm 发布隔离豁免仅针对确切宿主依赖版本。
- Verify clean tarball installation, host imports, background unit tests, and Web Settings on DSH `0.2.1-rc.2`. Foreground overlay validation was inconclusive under concurrent desktop use; the real-model desktop lane was not rerun.
- 已在 DSH `0.2.1-rc.2` 验证干净压缩包安装、宿主导入、后台单元测试及 Web 设置。前台浮层验收受并发桌面操作的焦点冲突影响，结论不完整；本轮未重跑模型桌面操作验收。

## 0.3.3 — 2026-10-01

- Adapt to DSH `0.2.0-rc.2` types, tool-message provenance, and explicit Connection injection for the Web Settings route. Rebuild the universal macOS helper as 0.3.3.
- 适配新版类型、工具消息来源和 Web Settings 路由的显式 Connection 依赖；同步重建 0.3.3 通用 macOS helper。
- Disable AppKit panel fade so the agent cursor disappears immediately when the bound target loses foreground focus.
- 禁用 AppKit 面板淡出动画，目标应用失去焦点后立即隐藏代理光标。
- Verified DSH `0.2.0-rc.2` with six real macOS native fixture tests, clean Web/Headless tarball installation and actual tool execution, Web Settings, and an official DeepSeek model driving the target-process click. The model lane verifies durable Session v4 tool-result evidence and screenshot artifacts.
- 已通过六项 macOS 原生测试、Web/Headless 干净压缩包安装及真实工具调用、Web 设置，以及官方 DeepSeek 模型驱动的目标进程点击；模型验收同时校验持久 Session v4 工具结果与截图产物。
- Update release fixtures for cursor-motion configuration, the DeepSeek Messages endpoint, explicit target CLI selection, and both legacy/wrapped and v4/direct tool-result logs.
- 更新验收夹具以覆盖光标速度配置、DeepSeek Messages 地址、明确目标 CLI，以及新旧工具结果日志格式。

## [Unreleased]

## [0.3.2] - 2026-09-10

### Fixed

- Adapted the durable-history probes to `Session.snapshotEvents()`, the accessor DSH 0.1.2 introduced in place of the `Session.events` getter. Both are still probed at runtime, so resume and replay keep working on every release line this package declares.

- Computer Use no longer aborts the whole Web profile on DSH 0.1.5 release candidates: the settings namespace is now the plain `'computer-use'` literal, because 0.1.5 removed the `settingsNamespace()` runtime brander and made the namespace brand compile-time only.
- Restored Skill-load detection for sessions replayed on a DSH 0.1.5 host. The PTC `run_code` sub-dispatch event was renamed from `tool/code-dispatch` to `tool/ptc-dispatch`; both names are now accepted, so `computer_use_activate` and post-resume tool re-exposure work again.

### Changed

- Web Settings maps an optimistic-concurrency conflict to HTTP 409 by the settings provider's stable `SETTINGS_CONFLICT` code instead of `instanceof` alone, so a second copy of the error class cannot downgrade it to a 400.
- Client prefetch metadata (`dsh.client.inject`) now names the packages that actually serve this plugin's client — the slot renderer, the settings General section that declares `settings.section`, the locale registry, the Remote API, and the connection event source — and the removed `@deepseek-ai/dsh-client-runtime` package is gone from both `dsh.client.inject` and `peerDependencies`.
- `dsh.compatibility` records `0.1.5-rc.1` as verified, and its `dsh` range now matches the prerelease versions it lists as compatible (a plain `>=0.1.0-rc.8 <0.2.0` matches none of them under strict semver prerelease rules).

## [0.3.1] - 2026-09-02

### Fixed

- Inlined client settings range validation into `src/client/index.tsx` so the single-file browser bundle loads directly without unbundled relative `require()` calls in the web module loader.

## [0.3.0] - 2026-09-01

### Added

- Added host-configurable Agent-cursor maximum speed, acceleration/deceleration, and post-arrival click delay, with natural human-readable defaults and high-throughput ranges in Web Settings.

### Changed

- The Agent cursor now appears only over the current frontmost target application, follows a slightly curved acceleration-shaped path from its previous point, completes arrival before click or drag press, and tracks the endpoint while native drag input runs.
- Existing 0.2.x `cursorMotionMs` values remain accepted during upgrade but no longer control runtime movement; the physical speed, acceleration, and click-delay defaults replace the fixed duration.

### Fixed

- Background pointer targets using `focusPolicy: activate` are now activated and freshly revalidated before cursor movement, so activation mode cannot bypass visible movement and dwell.
- Foreground cursor setup failures now block input consistently, queued cursor commands cancel promptly, and disposal cannot launch a late overlay process.
- Native drag now waits at a validated start barrier until endpoint cursor tracking is armed, and cancellation after mouse-down waits for the bounded native mouse-up instead of terminating mid-gesture.
- Web Settings now rejects cursor values outside the host-supported ranges with localized validation messages.

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
