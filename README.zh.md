# DSH Computer Use

**DSH Computer Use 是 DeepSeek Harness 的 Accessibility-first macOS 动作层。它让 Agent 通过新鲜、可回放的观察读取和操作原生应用，而不是依赖没有 scope 的坐标点击或任意桌面脚本。**

[English](README.md) | 中文

## 为什么需要它

Shell Tool 可以启动应用，浏览器 Tool 可以操作网页，但两者都没有提供通用的原生 macOS UI 协议。可靠的桌面 Agent 需要的不只是 `click(x, y)`：它必须识别准确的运行应用、读取当前 UI 结构、把动作绑定到该状态、拒绝过期目标、取得有 scope 的访问权限，并返回动作后应用的新状态。

本包补齐动作层，而不再造一套 Agent runtime。它提供一个 DSH Service、一个原生 macOS provider、一个可移植 Skill、按 Agent 渐进暴露的模型 Tool、截图 Artifact，以及 Web Settings 分区。`dsh-design` 等领域 Bundle 可以在任务跨入原生应用时组合它；浏览器和 API 任务继续使用更窄的能力。

## 产品定位

```text
dsh-vision-toolkit   visual facts, OCR, grounding, and pixel evidence
dsh-computer-use     native application observation and bounded UI actions
dsh-design           domain decisions and design completion criteria
```

DSH Computer Use 是可复用的**动作层**。它不实现视觉模型、设计工作流、浏览器协议、远程桌面流或替代桌面壳。

## 核心协议

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

每个元素 index 只属于一个 opaque `observationId`。修改型 Tool 必须携带该 ID；原生 provider 在发送输入前重新构建当前 UI 状态。元素动作会拒绝已经变化的进程、window、locator 或目标身份，但不会因无关 tree 更新失效；坐标和依赖 focus 的动作要求完整观察状态保持当前。陈旧操作以 `COMPUTER_STALE_OBSERVATION` 失败，不会猜测替代元素。

## 平台与前置条件

- macOS 14 或更高版本。
- 支持 Web 或 Headless Profile 的 DeepSeek Harness。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- 结构观察和 UI 动作需要 macOS 辅助功能权限。
- 只有请求截图时才需要 macOS 屏幕录制权限。

仓库提交的 helper 是 ad-hoc 签名的 `arm64` + `x86_64` universal binary。`native/macos/manifest.json` 固定其 SHA-256、源码摘要、架构和最低 macOS 版本；源码位于 `native/macos/Sources/Helper/`。

## 快速开始

克隆仓库，把 Bundle 加入需要使用它的 Profile，然后检查最终配置：

```sh
git clone https://github.com/dsh-external/dsh-computer-use.git
PLUGIN="$PWD/dsh-computer-use"

dsh plugin --profile web add "$PLUGIN"
dsh plugin --profile headless add "$PLUGIN"

dsh --profile web --dump-config
dsh --profile headless --dump-config
```

在挂载 `tool-skill` 的 Session 中加载 Skill：

```text
/computer-use
```

Skill 成功返回后，只为当前 Agent 激活执行 schema。`computer_use_activate` 是很小的恢复入口；激活成功后会从当前 Agent 隐藏。

适合首次验证的请求：

> 使用 Computer Use 检查正在运行的 DSH Computer Use Fixture，启用 deterministic option，并根据动作后返回的新状态报告结果。优先使用 Accessibility 元素，不要复用旧 observation。

## macOS 权限

Web Settings 分区展示 helper 完整性、Accessibility 状态、Screen Recording 状态、当前 generation、限制和按应用授权。只有用户点击后，按钮才会打开准确的 macOS 隐私设置页面；插件不会自行授予 TCC 权限。

缺少权限时：

1. 打开 DSH Settings → Computer Use。
2. 对 Accessibility 或 Screen Recording 使用 **打开 macOS 设置**。
3. 按 macOS 展示的当前 DSH host/helper 启动身份授予权限。
4. 如果 macOS 要求，重启对应 Host，然后点击**刷新健康状态**。

`computer_observe` 和所有原生动作都需要 Accessibility。`screenshot: "optional"` 可以在没有 Screen Recording 时省略截图；`screenshot: "required"` 会明确失败。

这些 TCC grant 是 UI 权限，不是文件系统权限。正常使用在 DSH `workspace-write` policy 下
运行：截图 Artifact 留在 Session workspace，插件临时文件使用 Session 私有临时存储，
Bundle 不要求 `danger-full-access`。

## 模型 Tool

部署初始只贡献 `computer_use_activate`。Agent 加载 `computer-use` 后获得以下聚焦 Tool：

| Tool | 用途 |
|---|---|
| `computer_list_apps` | 列出有界的用户应用，包括 bundle id、pid、frontmost 和权限诊断。 |
| `computer_observe` | 返回新的完整/差分 Accessibility observation 和可选截图 Artifact。 |
| `computer_click` | 优先执行 `AXPress`；可显式回退到观察元素 frame 或观察窗口坐标。 |
| `computer_set_value` | 不使用 clipboard，设置或清空可编辑 Accessibility value。 |
| `computer_type_text` | 优先通过 Accessibility 向当前聚焦控件插入 Unicode，不支持时回退 CoreGraphics；不读取或替换 clipboard。 |
| `computer_press_key` | 从有限的公开词汇发送一个按键，并可附加 command/control/option/shift。 |
| `computer_scroll` | 在观察元素或坐标处执行有界方向滚动。 |
| `computer_drag` | 在引用 observation 的窗口坐标空间中拖动。 |
| `computer_perform_action` | 执行所选元素明确报告的一项 Accessibility action。 |
| `computer_wait` | 轮询一个有界 text/role/title 条件，不修改应用并返回新状态。 |
| `computer_confirm` | 为一个准确的敏感动作取得一次性 approval token。 |

不存在接受 AppleScript、JXA、shell、Swift、Objective-C、原生 selector、任意 Accessibility 常量或源码的 Tool。

## Observation 模型

每次 observation 包含：

- opaque `observationId`、创建时间和过期时间；
- 准确的应用 `bundleId`、当前 `pid` 和名称；
- frontmost 与当前窗口 metadata；
- 有界的 Accessibility tree 文本；
- 当前元素行，包括 role、title/label、脱敏 value、状态、frame 和明确支持的 action；
- 可选截图 Artifact、像素尺寸和文件 metadata；
- Accessibility 与 Screen Recording 状态。

一个 Agent/应用组合的首次观察为 full；后续观察可以返回 diff。diff 中的 index 始终属于新返回的状态。之前上下文已被压缩或需要完整 tree 时，使用 `full: true`。

Secure text field 一律输出 `[secure]`；真实值不会进入 tree、Tool 结果、截图 metadata 或原生错误。截图仍可能包含应用里其他可见数据，因此 read access 依然按应用控制。

## 应用访问与敏感确认

技术访问分为两种 lease：

- **read**：检查 Accessibility 状态和请求的截图；
- **control**：向所选应用发送 UI 输入。

没有配置 grant 时，插件通过 DSH approval 请求权限。read approval 持续当前 Session；control approval 持续当前 turn。两者都绑定准确 Agent 和 bundle id。Headless 没有 approval answerer 时 fail closed。

部分动作还要求临近执行的语义确认：高影响外部沟通、传输敏感数据、不可逆删除、账户/安全/隐私修改、未经请求的软件安装、接受法律条款，或超出用户明确授权的金融完成动作。`computer_confirm` 返回短期 token，绑定准确应用、进程、observation 和动作字段。字段不匹配、过期或第二次使用都会被拒绝。

配置 grant 不会绕过敏感动作确认。

发送任何输入前，provider 会重新校验引用目标，请求激活已选择的进程，并在 `actionTimeoutMs` 内等待该应用成为 frontmost。键盘 fallback 发送到该准确 process id；坐标输入只在前台校验通过后发出。如果激活未完成，动作以 `COMPUTER_ACTION_BLOCKED` 失败，且不会发送输入。

## 配置

配置属于聚合的 `computer-use` Bundle row。该 row 先初始化 macOS Service provider，再发布 Skill 和 Agent-scoped Tool。所有随部署变化的限制都经过校验，也可以通过 Web Settings 实时修改。

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

| 字段 | 含义 |
|---|---|
| `observationTtlMs` | Observation ID 生命周期，`1000`–`120000`。 |
| `confirmationTtlMs` | 尚未使用的一次性 token 生命周期，`1000`–`900000`。 |
| `actionTimeoutMs` | 原生 helper 调用与目标应用激活硬超时，`1000`–`120000`。 |
| `settleMs` | 动作后状态检查间隔，`0`–`10000`。 |
| `maxSettleMs` | 动作后稳定/等待最大预算，`100`–`60000`。 |
| `maxNodes` / `maxDepth` / `maxTextBytes` | Accessibility 遍历和模型可见文本上限。 |
| `maxScreenshotBytes` | 允许的 PNG Artifact 最大字节数。 |
| `artifactRoot` | 不逃逸 workspace 的相对截图目录。 |
| `helper.path` | 可选的显式外部 helper executable。 |
| `helper.allowSourceBuild` | 提交的 helper 缺失时，允许显式执行托管源码重建；默认 `false`。 |
| `grants` | 准确、无通配符的 bundle-id read/control 策略；`control: true` 隐含 read。 |

外部 helper 路径必须是可执行普通文件，不能是符号链接。托管 helper 必须匹配提交的 manifest hash。软件包归档可能移除其 execute bit；provider 会先验证普通文件身份和 manifest hash，再仅恢复 owner execute 权限后启动。

## Web 与 Headless 行为

- **Web：**通过 `dsh.client` 增加 Settings 分区，管理健康、限制、helper 和准确 bundle-id grant。Tool 结果使用通用 card 和截图 Artifact metadata，不提供连续桌面流。
- **Headless：**提供完全相同的 Skill、Tool、observation 语义、错误和 Artifact。缺少交互 approval 时返回稳定权限/确认错误，不会静默允许控制。

Settings 更新按 generation 生效。候选 helper/config 必须先通过校验和健康检查，才能替换当前 generation；替换后旧 observation 和待用 confirmation 会失效。

## 稳定错误码

| Code | 正确下一步 |
|---|---|
| `COMPUTER_UNSUPPORTED_PLATFORM` | 使用受支持 provider 或其他能力。 |
| `COMPUTER_PERMISSION_REQUIRED` | 授予指定 macOS 权限或 DSH 应用 lease。 |
| `COMPUTER_APP_NOT_FOUND` | 列出应用，选择准确 bundle id 和 pid。 |
| `COMPUTER_STALE_OBSERVATION` | 重新观察并重新选择目标。 |
| `COMPUTER_ELEMENT_UNAVAILABLE` | 使用元素报告的 action，或显式坐标 fallback。 |
| `COMPUTER_TARGET_UNAVAILABLE` | 使用更窄能力、视觉 grounding，或询问用户。 |
| `COMPUTER_CONFIRMATION_REQUIRED` | 紧邻执行前确认准确的拟执行动作。 |
| `COMPUTER_ACTION_BLOCKED` | 检查新状态并选择其他受支持动作。 |
| `COMPUTER_TIMEOUT` | 检查当前状态；只有安全时才重试。 |
| `COMPUTER_CANCELLED` | 停止或重新评估任务。 |
| `COMPUTER_PROVIDER_FAILURE` | 检查有界诊断，不能推断动作成功。 |

## 开发与验证

仓库应放在 DeepSeek Harness checkout 旁边，以便 TypeScript compiler 使用准确的 peer API declaration。

```sh
pnpm install
pnpm run build
DSH_COMPUTER_USE_REQUIRE_TCC=1 pnpm test
pnpm pack --dry-run
node scripts/validate.mjs --lane all
pnpm run validate:model
```

`pnpm run build` 会编译并 ad-hoc 签名 universal helper，构建确定性 fixture 应用，生成 ESM runtime/types，并生成 loader-compatible Web client。原生 fixture 测试真实执行应用发现、Accessibility 观察、截图、AX click/value/action、Unicode 输入、按键、滚动、拖动、延迟状态、stale 拒绝、secure field 脱敏和进程终止。

发布 runner 还会检查提交的 `lib/`、native hash 与架构、tarball 内容、DSH plugin validator、干净 Web/Headless Profile 安装、渐进暴露、disable/re-enable/remove，以及在 `workspace-write` 下通过 DSH model Tool protocol 执行的真实 fixture 流程。`pnpm run validate:model` 会安装新打包的 tarball、启动确定性原生 fixture，并要求真实 DeepSeek 模型通过聚焦的 Computer Use Tool 完成应用发现、观察和操作；它要求 `DEEPSEEK_API_KEY`，并支持可选的 `DEEPSEEK_BASE_URL`。`pnpm run validate:release` 会执行两类验收；全部通过后才能推送。

## 范围与限制

- P0 只支持 macOS，不声称支持 Windows UI Automation 或 Linux。
- Accessibility 质量取决于目标应用；部分自定义 canvas 暴露不完整结构，需要截图/视觉 fallback。
- 浏览器任务应继续使用 browser automation，因为 DOM/CDP 更窄、更精确。
- 本包按请求捕获离散 observation，不提供实时桌面流。
- 坐标动作被限制在引用 observation 的窗口内，但可靠性仍低于 Accessibility action。
- 应用 lease 只建立技术访问，不能完成业务影响分类；后者由 Skill 和一次性确认协议处理。
- helper 不持久化原生 element pointer；每次动作都会重建当前状态并验证 hash。

## 移除

```sh
dsh plugin --profile web remove @dsh-external/dsh-computer-use
dsh plugin --profile headless remove @dsh-external/dsh-computer-use
```

移除或禁用 Bundle 会注销 Skill 和 Tool、取消在途 helper 操作、释放 Agent observation 与 confirmation、移除 Web route/client contribution。已经生成的截图文件留在 Session workspace，供用户显式清理。

## 许可证

MIT，见 [LICENSE](LICENSE)。
