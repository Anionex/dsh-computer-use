window.__ModuleLoader__.load({ id: "@dsh-external/dsh-computer-use", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = void 0;
exports.apply = apply;
const jsx_runtime_1 = require("react/jsx-runtime");
/** DSH Computer Use browser plugin: provider health, permissions, limits, and app policy. */
const react_1 = require("react");
const dsh_client_ui_primitives_1 = require("@deepseek-ai/dsh-client-ui-primitives");
const NS = 'computer-use';
const ROUTE = '/_dsh/computer-use/settings';
const en = {
    nav: 'Computer Use',
    title: 'macOS Computer Use',
    intro: 'Inspect the native helper, macOS privacy permissions, foreground/targeted-input policy, observation limits, and exact per-app read/control grants.',
    privacy: 'macOS privacy',
    advanced: 'Advanced options',
    advancedHint: 'Limits, helper path, cursor timing, and application grants.',
    cursorTiming: 'Cursor timing',
    helper: 'Native helper',
    ready: 'Ready',
    unavailable: 'Unavailable',
    generation: 'Generation',
    accessibility: 'Accessibility',
    screenRecording: 'Screen Recording',
    granted: 'Granted',
    denied: 'Needs permission',
    openSettings: 'Open macOS Settings',
    refresh: 'Refresh health',
    limits: 'Observation and action limits',
    ttl: 'Observation TTL (ms)',
    confirmationTtl: 'Confirmation TTL (ms)',
    actionTimeout: 'Action timeout (ms)',
    settle: 'Settlement interval (ms)',
    maxSettle: 'Maximum settlement (ms)',
    maxNodes: 'Maximum AX nodes',
    maxDepth: 'Maximum AX depth',
    maxText: 'Maximum AX text bytes',
    maxScreenshot: 'Maximum screenshot bytes',
    artifactRoot: 'Artifact root',
    helperPath: 'External helper path',
    sourceBuild: 'Allow explicit source-build fallback',
    interaction: 'Foreground and targeted input',
    interactionHint: 'The default route sends pointer and keyboard events only to the selected process. It does not move the system cursor or activate the app.',
    focusPolicy: 'Foreground policy',
    focusPreserve: 'Preserve current foreground app',
    focusActivate: 'Allow activating the target app',
    keyboardPolicy: 'Keyboard policy',
    keyboardPreserve: 'Preserve foreground; typing compatibility varies',
    keyboardActivate: 'Activate the target app before typing',
    pointerInputPolicy: 'Target-process pointer input',
    pointerDeny: 'Deny mouse, drag, and wheel events',
    pointerAllow: 'Route events only to the target process',
    cursorVisualization: 'Agent cursor',
    cursorVisible: 'Show a separate click-through Agent cursor',
    cursorHidden: 'Hide the Agent cursor',
    cursorMotion: 'Cursor travel (ms)',
    cursorAutoHide: 'Cursor auto-hide (ms)',
    grants: 'Application grants',
    grantsHint: 'One exact bundle id per line, followed by read or read,control. Wildcards are rejected.',
    allowAllApps: 'Allow read and control for every app',
    allowAllAppsHint: 'When enabled, exact grants are ignored and every running app is readable and controllable.',
    save: 'Save and apply',
    saving: 'Applying...',
    saved: 'Settings applied.',
    readOnly: 'The current Settings provider is read-only.',
    loading: 'Loading Computer Use settings...',
    retry: 'Retry',
};
const zh = {
    nav: 'Computer Use',
    title: 'macOS Computer Use',
    intro: '检查原生 helper、macOS 隐私权限、前台与定向输入策略、观察限制，以及按应用配置的精确 read/control grant。',
    privacy: 'macOS 隐私',
    advanced: '高级选项',
    advancedHint: '限制、helper 路径、光标时序与应用授权。',
    cursorTiming: '光标时序',
    helper: '原生 helper',
    ready: '可用',
    unavailable: '不可用',
    generation: '世代',
    accessibility: '辅助功能',
    screenRecording: '屏幕录制',
    granted: '已授权',
    denied: '需要授权',
    openSettings: '打开 macOS 设置',
    refresh: '刷新健康状态',
    limits: '观察与动作限制',
    ttl: 'Observation TTL（毫秒）',
    confirmationTtl: '确认 Token TTL（毫秒）',
    actionTimeout: '动作超时（毫秒）',
    settle: '稳定检查间隔（毫秒）',
    maxSettle: '最大稳定等待（毫秒）',
    maxNodes: '最大 AX 节点数',
    maxDepth: '最大 AX 深度',
    maxText: '最大 AX 文本字节数',
    maxScreenshot: '最大截图字节数',
    artifactRoot: 'Artifact 目录',
    helperPath: '外部 helper 路径',
    sourceBuild: '允许显式源码构建 fallback',
    interaction: '前台与定向输入',
    interactionHint: '默认只把指针和键盘事件投递给选定进程，不移动系统光标，也不激活目标应用。',
    focusPolicy: '前台策略',
    focusPreserve: '保持当前前台应用',
    focusActivate: '允许激活目标应用',
    keyboardPolicy: '键盘策略',
    keyboardPreserve: '保持前台；输入兼容性因应用而异',
    keyboardActivate: '输入前激活目标应用',
    pointerInputPolicy: '目标进程指针输入',
    pointerDeny: '禁止鼠标、拖拽和滚轮事件',
    pointerAllow: '只向目标进程投递事件',
    cursorVisualization: 'Agent 光标',
    cursorVisible: '显示独立且点击穿透的 Agent 光标',
    cursorHidden: '隐藏 Agent 光标',
    cursorMotion: '光标移动时长（毫秒）',
    cursorAutoHide: '光标自动隐藏（毫秒）',
    grants: '应用授权',
    grantsHint: '每行一个精确 bundle id，后接 read 或 read,control；不接受通配符。',
    allowAllApps: '允许 read/control 所有应用',
    allowAllAppsHint: '开启后忽略下方精确授权，所有运行中的应用都可读取和控制。',
    save: '保存并应用',
    saving: '正在应用...',
    saved: '设置已生效。',
    readOnly: '当前 Settings 提供方为只读。',
    loading: '正在加载 Computer Use 设置...',
    retry: '重试',
};
class ComputerUseSettingsController {
    state = { status: 'idle' };
    listeners = new Set();
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    snapshot = () => this.state;
    publish(next) {
        this.state = next;
        for (const listener of this.listeners)
            listener();
    }
    async load() {
        this.publish({
            status: 'loading',
            ...(this.state.snapshot === undefined ? {} : { snapshot: this.state.snapshot }),
        });
        try {
            const response = await fetch(ROUTE, { credentials: 'same-origin', cache: 'no-store' });
            const body = await response.json();
            if (!response.ok || body.ok !== true || body.value === undefined)
                throw new Error(body.error?.message ?? `HTTP ${response.status}`);
            this.publish({ status: 'ready', snapshot: body.value });
        }
        catch (error) {
            this.publish({ status: 'error', error: error instanceof Error ? error.message : String(error) });
        }
    }
    async action(action, payload, marker) {
        this.publish({
            status: this.state.status,
            action: marker,
            ...(this.state.snapshot === undefined ? {} : { snapshot: this.state.snapshot }),
        });
        try {
            const response = await fetch(ROUTE, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action, ...payload }),
            });
            const body = await response.json();
            if (!response.ok || body.ok !== true || body.value === undefined)
                throw new Error(body.error?.message ?? `HTTP ${response.status}`);
            this.publish({
                status: 'ready',
                snapshot: body.value,
                ...(action === 'save' ? { notice: 'saved' } : {}),
            });
        }
        catch (error) {
            this.publish({
                status: 'ready',
                ...(this.state.snapshot === undefined ? {} : { snapshot: this.state.snapshot }),
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    refreshIfLoaded() {
        if (this.state.status !== 'idle')
            void this.load();
    }
}
function draftOf(value) {
    return {
        observationTtlMs: String(value.observationTtlMs ?? 15000),
        confirmationTtlMs: String(value.confirmationTtlMs ?? 300000),
        actionTimeoutMs: String(value.actionTimeoutMs ?? 15000),
        settleMs: String(value.settleMs ?? 250),
        maxSettleMs: String(value.maxSettleMs ?? 5000),
        maxNodes: String(value.maxNodes ?? 500),
        maxDepth: String(value.maxDepth ?? 14),
        maxTextBytes: String(value.maxTextBytes ?? 64000),
        maxScreenshotBytes: String(value.maxScreenshotBytes ?? 33554432),
        artifactRoot: value.artifactRoot ?? '.dsh-computer-use/artifacts',
        helperPath: value.helper?.path ?? '',
        allowSourceBuild: value.helper?.allowSourceBuild ?? false,
        focusPolicy: value.interaction?.focusPolicy ?? 'preserve',
        keyboardPolicy: value.interaction?.keyboardPolicy ?? 'preserve',
        pointerInputPolicy: value.interaction?.pointerInputPolicy ?? 'targeted',
        cursorVisualization: value.interaction?.cursorVisualization ?? 'visible',
        cursorMotionMs: String(value.interaction?.cursorMotionMs ?? 180),
        cursorAutoHideMs: String(value.interaction?.cursorAutoHideMs ?? 1400),
        allowAllApps: value.allowAllApps ?? false,
        grants: (value.grants ?? []).map(grant => `${grant.bundleId} ${grant.control === true ? 'read,control' : 'read'}`).join('\n'),
    };
}
function integer(value, name) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0)
        throw new Error(`${name} must be a non-negative integer`);
    return parsed;
}
function configOf(draft) {
    const grants = draft.grants.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).map((line) => {
        const [bundleId, rawScopes, ...extra] = line.split(/\s+/u);
        if (bundleId === undefined || rawScopes === undefined || extra.length > 0)
            throw new Error(`invalid grant line: ${line}`);
        const scopes = new Set(rawScopes.split(','));
        if (![...scopes].every(scope => scope === 'read' || scope === 'control'))
            throw new Error(`invalid grant scope: ${line}`);
        return { bundleId, read: true, control: scopes.has('control') };
    });
    return {
        observationTtlMs: integer(draft.observationTtlMs, 'observationTtlMs'),
        confirmationTtlMs: integer(draft.confirmationTtlMs, 'confirmationTtlMs'),
        actionTimeoutMs: integer(draft.actionTimeoutMs, 'actionTimeoutMs'),
        settleMs: integer(draft.settleMs, 'settleMs'),
        maxSettleMs: integer(draft.maxSettleMs, 'maxSettleMs'),
        maxNodes: integer(draft.maxNodes, 'maxNodes'),
        maxDepth: integer(draft.maxDepth, 'maxDepth'),
        maxTextBytes: integer(draft.maxTextBytes, 'maxTextBytes'),
        maxScreenshotBytes: integer(draft.maxScreenshotBytes, 'maxScreenshotBytes'),
        artifactRoot: draft.artifactRoot.trim(),
        helper: {
            ...(draft.helperPath.trim().length === 0 ? {} : { path: draft.helperPath.trim() }),
            allowSourceBuild: draft.allowSourceBuild,
        },
        interaction: {
            focusPolicy: draft.focusPolicy,
            keyboardPolicy: draft.keyboardPolicy,
            pointerInputPolicy: draft.pointerInputPolicy,
            cursorVisualization: draft.cursorVisualization,
            cursorMotionMs: integer(draft.cursorMotionMs, 'interaction.cursorMotionMs'),
            cursorAutoHideMs: integer(draft.cursorAutoHideMs, 'interaction.cursorAutoHideMs'),
        },
        allowAllApps: draft.allowAllApps,
        grants,
    };
}
function Field({ label, children }) {
    return (0, jsx_runtime_1.jsxs)("label", { className: "dcu-field", children: [(0, jsx_runtime_1.jsx)("span", { children: label }), children] });
}
function SettingsSection({ controller, t }) {
    if (controller === undefined || t === undefined)
        return null;
    return (0, jsx_runtime_1.jsx)(LoadedSettings, { controller: controller, t: t });
}
function PermissionCard({ label, state, kind, controller, t }) {
    const granted = state === 'granted';
    return (0, jsx_runtime_1.jsxs)("article", { className: "dcu-permission", "data-granted": granted || undefined, children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { children: label }), (0, jsx_runtime_1.jsx)("strong", { children: granted ? t('granted') : t('denied') })] }), !granted ? (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", onClick: () => { void controller.action('open-settings', { kind }, 'open'); }, children: t('openSettings') }) : null] });
}
function LoadedSettings({ controller, t }) {
    const state = (0, react_1.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
    const [draft, setDraft] = (0, react_1.useState)();
    const [draftError, setDraftError] = (0, react_1.useState)();
    (0, react_1.useEffect)(() => { if (state.status === 'idle')
        void controller.load(); }, [controller, state.status]);
    (0, react_1.useEffect)(() => { if (state.snapshot !== undefined)
        setDraft(draftOf(state.snapshot.settings.value)); }, [state.snapshot]);
    if (state.snapshot === undefined || draft === undefined) {
        return (0, jsx_runtime_1.jsxs)("div", { className: "dcu-settings", children: [(0, jsx_runtime_1.jsx)("div", { className: "dcu-panel", children: state.error ?? t('loading') }), state.status === 'error' ? (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", onClick: () => { void controller.load(); }, children: t('retry') }) : null] });
    }
    const snapshot = state.snapshot;
    const update = (key, value) => setDraft(current => current === undefined ? current : { ...current, [key]: value });
    const save = () => {
        try {
            setDraftError(undefined);
            void controller.action('save', { expectedRevision: snapshot.settings.revision, value: configOf(draft) }, 'save');
        }
        catch (error) {
            setDraftError(error instanceof Error ? error.message : String(error));
        }
    };
    const numberField = (key, label) => (0, jsx_runtime_1.jsx)(Field, { label: label, children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { value: String(draft[key]), onChange: event => update(key, event.target.value) }) });
    return (0, jsx_runtime_1.jsxs)("div", { className: "dcu-settings", children: [(0, jsx_runtime_1.jsxs)("header", { className: "dcu-header", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "dcu-kicker", children: "DSH native capability" }), (0, jsx_runtime_1.jsx)("h2", { children: t('title') }), (0, jsx_runtime_1.jsx)("p", { children: t('intro') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dcu-release", children: [(0, jsx_runtime_1.jsxs)("span", { children: [t('helper'), " ", (0, jsx_runtime_1.jsx)("strong", { children: snapshot.provider.helperVersion ?? 'unknown' })] }), (0, jsx_runtime_1.jsxs)("span", { children: [t('generation'), " ", (0, jsx_runtime_1.jsx)("strong", { children: snapshot.provider.generation })] }), (0, jsx_runtime_1.jsx)("span", { className: snapshot.provider.ready ? 'ok' : 'bad', children: snapshot.provider.ready ? t('ready') : t('unavailable') })] })] }), snapshot.provider.lastError === undefined ? null : (0, jsx_runtime_1.jsx)("div", { className: "dcu-alert error", children: snapshot.provider.lastError }), !snapshot.writable ? (0, jsx_runtime_1.jsx)("div", { className: "dcu-alert warning", children: t('readOnly') }) : null, state.error === undefined && draftError === undefined ? null : (0, jsx_runtime_1.jsx)("div", { className: "dcu-alert error", children: draftError ?? state.error }), state.notice === 'saved' ? (0, jsx_runtime_1.jsx)("div", { className: "dcu-alert ok", children: t('saved') }) : null, (0, jsx_runtime_1.jsxs)("section", { className: "dcu-panel", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dcu-panel-title", children: [(0, jsx_runtime_1.jsx)("h3", { children: t('privacy') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", onClick: () => { void controller.action('health', {}, 'health'); }, children: t('refresh') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dcu-permissions", children: [(0, jsx_runtime_1.jsx)(PermissionCard, { label: t('accessibility'), state: snapshot.provider.accessibility, kind: "accessibility", controller: controller, t: t }), (0, jsx_runtime_1.jsx)(PermissionCard, { label: t('screenRecording'), state: snapshot.provider.screenRecording, kind: "screen-recording", controller: controller, t: t })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dcu-panel", children: [(0, jsx_runtime_1.jsx)("div", { className: "dcu-panel-title", children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { children: t('interaction') }), (0, jsx_runtime_1.jsx)("p", { children: t('interactionHint') })] }) }), (0, jsx_runtime_1.jsxs)("div", { className: "dcu-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('focusPolicy'), children: (0, jsx_runtime_1.jsxs)("select", { value: draft.focusPolicy, onChange: event => update('focusPolicy', event.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "preserve", children: t('focusPreserve') }), (0, jsx_runtime_1.jsx)("option", { value: "activate", children: t('focusActivate') })] }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('keyboardPolicy'), children: (0, jsx_runtime_1.jsxs)("select", { value: draft.keyboardPolicy, onChange: event => update('keyboardPolicy', event.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "preserve", children: t('keyboardPreserve') }), (0, jsx_runtime_1.jsx)("option", { value: "activate", children: t('keyboardActivate') })] }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('pointerInputPolicy'), children: (0, jsx_runtime_1.jsxs)("select", { value: draft.pointerInputPolicy, onChange: event => update('pointerInputPolicy', event.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "deny", children: t('pointerDeny') }), (0, jsx_runtime_1.jsx)("option", { value: "targeted", children: t('pointerAllow') })] }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('cursorVisualization'), children: (0, jsx_runtime_1.jsxs)("select", { value: draft.cursorVisualization, onChange: event => update('cursorVisualization', event.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "visible", children: t('cursorVisible') }), (0, jsx_runtime_1.jsx)("option", { value: "hidden", children: t('cursorHidden') })] }) })] })] }), (0, jsx_runtime_1.jsxs)("details", { className: "dcu-advanced", children: [(0, jsx_runtime_1.jsxs)("summary", { children: [(0, jsx_runtime_1.jsx)("span", { children: t('advanced') }), (0, jsx_runtime_1.jsx)("small", { children: t('advancedHint') })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dcu-advanced-body", children: [(0, jsx_runtime_1.jsxs)("section", { className: "dcu-panel", children: [(0, jsx_runtime_1.jsx)("div", { className: "dcu-panel-title", children: (0, jsx_runtime_1.jsx)("h3", { children: t('limits') }) }), (0, jsx_runtime_1.jsxs)("div", { className: "dcu-grid", children: [numberField('observationTtlMs', t('ttl')), numberField('confirmationTtlMs', t('confirmationTtl')), numberField('actionTimeoutMs', t('actionTimeout')), numberField('settleMs', t('settle')), numberField('maxSettleMs', t('maxSettle')), numberField('maxNodes', t('maxNodes')), numberField('maxDepth', t('maxDepth')), numberField('maxTextBytes', t('maxText')), numberField('maxScreenshotBytes', t('maxScreenshot')), (0, jsx_runtime_1.jsx)(Field, { label: t('artifactRoot'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { value: draft.artifactRoot, onChange: event => update('artifactRoot', event.target.value) }) })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dcu-panel", children: [(0, jsx_runtime_1.jsx)("div", { className: "dcu-panel-title", children: (0, jsx_runtime_1.jsx)("h3", { children: t('cursorTiming') }) }), (0, jsx_runtime_1.jsxs)("div", { className: "dcu-grid", children: [numberField('cursorMotionMs', t('cursorMotion')), numberField('cursorAutoHideMs', t('cursorAutoHide'))] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dcu-panel", children: [(0, jsx_runtime_1.jsx)("div", { className: "dcu-panel-title", children: (0, jsx_runtime_1.jsx)("h3", { children: t('helper') }) }), (0, jsx_runtime_1.jsx)("code", { className: "dcu-path", children: snapshot.provider.helperPath }), snapshot.provider.helperSha256 === undefined ? null : (0, jsx_runtime_1.jsxs)("code", { className: "dcu-path", children: ["sha256 ", snapshot.provider.helperSha256] }), (0, jsx_runtime_1.jsxs)("div", { className: "dcu-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('helperPath'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { value: draft.helperPath, placeholder: "managed", onChange: event => update('helperPath', event.target.value) }) }), (0, jsx_runtime_1.jsxs)("label", { className: "dcu-check", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: draft.allowSourceBuild, onChange: event => update('allowSourceBuild', event.target.checked) }), (0, jsx_runtime_1.jsx)("span", { children: t('sourceBuild') })] })] })] }), (0, jsx_runtime_1.jsxs)("section", { className: "dcu-panel", children: [(0, jsx_runtime_1.jsx)("div", { className: "dcu-panel-title", children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { children: t('grants') }), (0, jsx_runtime_1.jsx)("p", { children: t('grantsHint') })] }) }), (0, jsx_runtime_1.jsxs)("label", { className: "dcu-check", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: draft.allowAllApps, onChange: event => update('allowAllApps', event.target.checked) }), (0, jsx_runtime_1.jsxs)("span", { children: [t('allowAllApps'), " \u2014 ", t('allowAllAppsHint')] })] }), (0, jsx_runtime_1.jsx)("textarea", { value: draft.grants, disabled: draft.allowAllApps, onChange: event => update('grants', event.target.value), placeholder: 'com.example.App read\ncom.example.Editor read,control' })] })] })] }), (0, jsx_runtime_1.jsx)("div", { className: "dcu-actions", children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { disabled: !snapshot.writable || state.action !== undefined, onClick: save, children: state.action === 'save' ? t('saving') : t('save') }) })] });
}
const CSS = `
.dcu-settings{display:grid;gap:14px;max-width:920px;padding:2px 0 24px}.dcu-header{display:flex;justify-content:space-between;gap:22px;align-items:flex-start;padding:18px 20px;border-radius:16px;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2,#f5f4f1),var(--dsw-alias-bg-layer-1,#fff));border:1px solid var(--dsw-alias-border-subtle,#dedbd5)}.dcu-header h2{margin:4px 0 6px;font-size:20px}.dcu-header p{margin:0;max-width:610px;font-size:12px;line-height:1.55;color:var(--dsw-alias-fg-muted,#706d67)}.dcu-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#687f74;font-weight:700}.dcu-release{display:grid;gap:5px;min-width:190px;padding:10px 12px;border-radius:11px;background:rgba(255,255,255,.58);font-size:10px}.dcu-release span{display:flex;justify-content:space-between;gap:12px}.dcu-release .ok{color:#277d52}.dcu-release .bad{color:#aa3939}.dcu-panel{display:grid;gap:13px;padding:16px;border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff)}.dcu-panel-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.dcu-panel-title h3{margin:0;font-size:14px}.dcu-panel-title p{margin:4px 0 0;font-size:10px;color:var(--dsw-alias-fg-muted,#706d67)}.dcu-permissions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dcu-permission{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px;border-radius:11px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);border-left:3px solid #cc5555}.dcu-permission[data-granted]{border-left-color:#3ca26b}.dcu-permission div{display:grid;gap:3px}.dcu-permission span{font-size:10px}.dcu-permission strong{font-size:11px}.dcu-path{display:block;overflow:auto;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);font-size:10px;color:var(--dsw-alias-fg-muted,#706d67)}.dcu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.dcu-field{display:grid;gap:5px}.dcu-field>span{font-size:10px;font-weight:650}.dcu-field select,.dcu-panel textarea{border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}.dcu-field select{min-height:34px;padding:6px 9px;font:11px inherit}.dcu-check{display:flex;align-items:center;gap:8px;padding-top:19px;font-size:11px}.dcu-panel textarea{min-height:110px;resize:vertical;padding:10px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.dcu-alert{padding:10px 12px;border-radius:10px;font-size:11px}.dcu-alert.error{background:rgba(205,72,72,.1);color:#a13b3b}.dcu-alert.warning{background:rgba(211,151,49,.12);color:#8b651f}.dcu-alert.ok{background:rgba(48,154,100,.12);color:#267d52}.dcu-actions{display:flex;justify-content:flex-end}@media(max-width:720px){.dcu-header{display:grid}.dcu-release{width:auto}.dcu-grid,.dcu-permissions{grid-template-columns:1fr}}
`;
const ADVANCED_CSS = `.dcu-advanced{border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);overflow:hidden}.dcu-advanced>summary{display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;list-style:none;font-size:13px;font-weight:650}.dcu-advanced>summary::-webkit-details-marker{display:none}.dcu-advanced>summary small{margin-left:auto;font-size:10px;font-weight:400;color:var(--dsw-alias-fg-muted,#706d67)}.dcu-advanced>summary::after{content:"▸";margin-left:2px;font-size:12px;color:var(--dsw-alias-fg-muted,#706d67);transform:rotate(0deg);transition:transform .15s ease}.dcu-advanced[open]>summary::after{transform:rotate(90deg)}.dcu-advanced-body{display:grid;gap:14px;padding:2px 16px 16px}`;
function installStyles() {
    const id = '@dsh-external/dsh-computer-use/client';
    const existing = document.querySelector(`style[data-plugin-css="${id}"]`);
    if (existing !== null)
        return () => { };
    const style = document.createElement('style');
    style.dataset.plugin = '@dsh-external/dsh-computer-use';
    style.dataset.pluginCss = id;
    style.textContent = CSS + ADVANCED_CSS;
    document.head.appendChild(style);
    return () => { style.remove(); };
}
/** Required browser services. */
exports.inject = ['slots', 'locale'];
/** Register the Computer Use Settings section. */
function apply(ctx) {
    ctx.effect(installStyles, 'dsh-computer-use: styles');
    ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-computer-use: locale');
    const t = ctx.locale.bind(NS);
    const controller = new ComputerUseSettingsController();
    ctx.effect(() => {
        const disposers = [
            ctx.on('settings/changed', namespace => { if (namespace === 'computer-use')
                controller.refreshIfLoaded(); }),
            ctx.on('connection/reset', () => { controller.refreshIfLoaded(); }),
        ];
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'dsh-computer-use: Settings invalidation');
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'computer-use',
        order: 35,
        label: () => t('nav'),
        inject: () => ({ controller, t }),
    }, SettingsSection));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
