# 前台安全输入策略

## 需求

DSH Computer Use 应让 Agent 操作原生 macOS 应用时，用户仍能在其他应用中继续工作。默认路径不能移动系统光标、向全局 HID 事件流投递指针事件，也不能只为完成动作就激活目标应用。指针动作可以显示独立 Agent 光标，但 overlay 绝不能成为输入源或窗口管理器参与者。

Bundle 默认配置为：

```yaml
interaction:
  focusPolicy: preserve
  pointerInputPolicy: targeted
  cursorVisualization: visible
  cursorMotionMs: 180
  cursorAutoHideMs: 1400
```

`preserve` 表示 helper 不请求前台激活。`targeted` 表示鼠标、拖拽和滚轮事件只能投递给准确的已观察进程与窗口。`visible` 开启独立 Agent 光标，其移动与自动隐藏时长同样归宿主所有。模型不能通过 Tool 参数修改任何交互策略。

这是一项输入路由属性，并不是只要拿到 Accessibility 权限就自然成立。Accessibility 授予语义化 UI 访问能力；真正避免抢前台的是优先使用语义化 Accessibility 操作，并用进程/窗口定向 fallback 代替系统光标。

## 总体设计

动作路径按以下四层执行：

1. DSH Service 把请求绑定到一个未过期 observation、准确 bundle id、pid、窗口，以及元素或窗口相对坐标。
2. Native helper 再次观察目标，拒绝已经变化或存在歧义的状态。
3. Helper 优先使用 `AXPress`、Accessibility value 赋值、selected-text 赋值，或元素声明的 action。
4. 语义输入不可用时，键盘事件定向投递到选定 pid；指针事件定向投递到选定 pid 和窗口。任何指针 fallback 都不使用全局 event tap。

指针投递会解析准确 `CGWindowID`，把屏幕坐标换算为窗口本地坐标，在事件中标记目标 pid/window 字段，再通过 `SLEventPostToPid` 投递。缺少窗口身份、SkyLight symbol 不可用或窗口匹配有歧义时都会 fail closed。

视觉反馈由专用、常驻的光标进程创建 56x56 `NSPanel`。该 panel 无边框、不激活应用、点击穿透，并且不会进入普通窗口切换列表；它不会在全部 Space 上显示。它绘制一个带深色描边、阴影和固定紫色 Agent badge 的大号白色箭头。输入前它会以 ease-out 动画移动到相同的屏幕全局目标点，click 时短暂压缩箭头，drag 期间保持按压状态，空闲后自动隐藏。这个 overlay 不发出输入，也不会改变系统光标位置。

受支持的 DSH Tool 路径会执行两层策略检查。Service 会在申请 control lease 或消费敏感动作 confirmation 之前拒绝已知需要指针或前台权限的动作；helper 会在真正发出输入前再次校验同一份已解析策略，包括只能在运行时确定的 fallback。Helper 还要求独立进程组，以及三条标准 pipe 或 Unix socket 传输的对端都属于它的直接父进程；普通 shell 重定向会在解析命令前 fail closed。这个传输检查只属于纵深防御，不会认证同一 macOS 用户下运行的任意代码：专门构造的 detached 父进程仍能复现这类拓扑，尤其是在 `danger-full-access` 下。注册 Tool 路径仍是唯一受支持的调用方式，因为它会在调用 helper 前执行 lease、confirmation 与宿主策略。

每个动作结果都会报告实际使用的路由：

```ts
activation: 'not-requested' | 'already-frontmost' | 'activated'
pointerInput: boolean
pointerRouting: 'none' | 'target-process'
```

这些字段不会声称目标应用绝不可能因自身副作用改变焦点，只报告 helper 实际请求和发出的行为。

## 动作矩阵

| 动作路径 | 默认激活行为 | 指针路由 | 默认结果 |
|---|---|---|---|
| 通过 `AXPress` 的 `click` | 不激活 | 无 | 允许 |
| 通过 Accessibility 的 `set-value` | 不激活 | 无 | 允许 |
| 元素声明且不影响前台的 `perform-action` | 不激活 | 无 | 允许 |
| `AXRaise` | 拒绝 | 无 | 需要显式 `focusPolicy: activate`，随后重新观察/校验 |
| 通过 selected-text 赋值的 `type-text` | 不激活 | 无 | 当前 focused element 接受时允许 |
| `type-text` 键盘 fallback | 不激活 | 目标 pid | 允许；兼容性取决于目标应用 |
| `press-key` | 不激活 | 目标 pid | 允许；兼容性取决于目标应用 |
| 坐标点击或元素 frame fallback | 不激活 | 目标 pid + window | `pointerInputPolicy: targeted` 时允许 |
| 滚动 | 不激活 | 目标 pid + window | `pointerInputPolicy: targeted` 时允许 |
| 拖拽 | 不激活 | 目标 pid + window | `pointerInputPolicy: targeted` 时允许 |

`pointerInputPolicy: deny` 会禁用坐标点击/fallback、滚动和拖拽，但保留语义化 Accessibility 与进程定向键盘路径。

## 关键决策

### 宿主策略不是 Tool 参数

`focusPolicy` 与 `pointerInputPolicy` 归部署方所有。`allowCoordinateFallback` 只表示 `computer_click` 在 `AXPress` 不可用后可以尝试宿主已授权的指针路由，不能自行开启指针投递或前台激活。`computer_perform_action` 也会把 `AXRaise` 视为影响前台的动作，并在 `preserve` 下拒绝。

### Accessibility 始终是主路径

语义化 Accessibility 操作比像素坐标更稳定，不需要模拟光标，并且能在许多后台应用上工作。Helper 会先重新校验准确目标，再调用这些操作，并返回 `activation: not-requested`、`pointerInput: false` 和 `pointerRouting: none`。

### 默认指针路由是虚拟且目标定向的

Helper 不会先移动系统光标再尝试恢复。那种设计仍会打断用户、与真实输入竞争，还可能把事件送错应用。

指针 fallback 会在已观察的屏幕点创建事件，将其绑定到准确 pid 和 `CGWindowID`，填入 AppKit 需要的窗口本地坐标，再通过 SkyLight 的进程定向路由发出。点击、滚动与拖拽共用这条路径。提交的 helper 不包含 `CGWarpMouseCursorPosition`、全局 `CGEventPost` 或 `.post(tap: .cghidEventTap)` 路径。

### 光标可视化只负责展示

可见 Agent 光标有意不作为输入源。它是独立进程，使用严格 JSON-lines 协议和启动就绪握手。每次 show、press 与 release 都绑定已观察的 pid、`CGWindowID` 和预期 frame；目标窗口关闭、移动、缩放、最小化或离开屏幕时，overlay 会隐藏。由于展示与输入路由彼此独立，关闭光标不会改变动作语义，overlay 失败也不能改道或全局发出输入。

### 激活是显式兼容模式

少数应用只有在 active 状态下才接受输入。部署方可以设置 `focusPolicy: activate`，并明确接受目标应用可能抢到前台。Helper 会先激活准确进程，再次观察并重新校验引用窗口与元素，然后才发出输入。任何状态变化都会返回 `COMPUTER_STALE_OBSERVATION`，而不是继续操作激活前的目标。

默认 `preserve` 策略不会执行这个激活步骤。

### 指针投递必须 fail closed

目标进程指针投递需要准确的屏幕内窗口 id 和 frame。如果 Accessibility 没有暴露 `AXWindowNumber`，helper 会按 pid、frame 和 title 查询 CoreGraphics window list，并且只接受唯一匹配。它不会在多个窗口之间猜测，也不会退回全局光标。

### Private SPI 被隔离并允许运行时缺失

进程定向指针路由使用动态解析的 SkyLight symbol。这样在不支持的 macOS 版本上会明确失败：语义化 Accessibility 与进程定向键盘输入仍可用，指针 fallback 返回 `COMPUTER_ACTION_BLOCKED`。Helper 不会静默切换成全局指针注入。

## 已验证证据

发布证据同时覆盖实现与真实行为：

- 源码与 binary 检查会拒绝系统光标 warp symbol、准确的全局 `CGEventPost` symbol，以及未知的动态解析 native symbol；
- overlay 检查要求 nonactivating panel、点击穿透、prohibited 应用激活策略，并拒绝任何 cursor warp primitive；
- overlay runtime 会拒绝缺失或格式错误的目标身份、超长或非法 JSON-lines 命令、不支持的时长，以及不拥有托管父进程传输的直接 helper 调用；
- 真实 overlay 进程必须在执行命令前输出 ready frame，多条命令复用同一进程，并在释放时干净退出；
- native monitor 要求 overlay 是该进程拥有的唯一 56x56 窗口、不会成为前台，且该进程 pid 不产生任何全局 pointer event；
- helper 必须包含 `SLEventPostToPid` 与 `CGEventSetWindowLocation`；
- fixture 通过 `open -g` 与 `--background` 启动，LaunchServices 不会请求前台激活；
- fixture 记录每次 `applicationDidBecomeActive` 回调，默认路径必须保持 `activationCount: 0`；
- 独立 native monitor 会在 click、scroll 与 drag 整个动作期间每毫秒采样系统光标和前台 pid，所有采样都必须保持不变；
- 后台 `AXPress`、Accessibility value/action、selected-text 输入与 pid 定向按键都能修改 fixture 且不激活它；
- 目标进程 click 与 scroll 各只被观察到一次；drag 只产生一组 down/up gesture；目标始终不是前台应用；
- `pointerInputPolicy: deny` 会在任何目标指针事件发出前拒绝 click fallback、scroll 与 drag；
- 干净 Profile 与真实模型验证要求模型可见动作结果和 fixture transcript 相互一致。

## 已知限制

- 目标进程指针投递不如语义化 Accessibility 普适。自定义 canvas、游戏、强化输入 surface 或未来 macOS 变化可能拒绝该路由。
- 窗口必须在屏幕内且能唯一识别。最小化、完全隐藏、有歧义或无窗口目标会 fail closed。
- `focusPolicy: activate` 会有意打断前台工作，只作为操作方显式选择的兼容模式。
- 目标应用可能因接受动作而自行改变 activation 或 focus；helper 不承诺控制应用内部副作用。
- Agent 光标只属于当前 Space 和准确已观察窗口。`cursorAutoHideMs: 0` 会让它持续显示，直到绑定窗口变化、收到新的 hide 命令或 helper 被释放。
