/** macOS Accessibility/CoreGraphics/ScreenCaptureKit provider for `ctx.computerUse`. */
import { setTimeout as delay } from 'node:timers/promises';
import { Service } from '@deepseek-ai/cordis';
import { Config, COMPUTER_USE_SETTINGS_NAMESPACE, resolveConfig, } from "../config.js";
import { ComputerUseError } from "../errors.js";
import { ComputerUseService } from "../service.js";
import { NativeHelperClient } from "./native-helper.js";
/** Fixed-command native backend. */
class MacOSBackend {
    config;
    name = 'macos-ax';
    client;
    constructor(ctx, config) {
        this.config = config;
        this.client = new NativeHelperClient(ctx, config);
    }
    get helperPath() {
        return this.client.helperPath;
    }
    async resolveApp(selector, signal) {
        return await this.client.invoke({ command: 'resolve-app', selector }, signal);
    }
    async listApps(signal) {
        return await this.client.invoke({ command: 'list-apps' }, signal);
    }
    async observe(app, options, signal) {
        return await this.client.invoke({
            command: 'observe',
            app,
            options,
        }, signal);
    }
    async act(request, signal) {
        return await this.client.invoke({
            command: 'act',
            request: {
                ...request,
                actionTimeoutMs: this.config.actionTimeoutMs,
                limits: {
                    maxNodes: this.config.maxNodes,
                    maxDepth: this.config.maxDepth,
                    maxTextBytes: this.config.maxTextBytes,
                },
            },
        }, signal);
    }
    async visualizeCursor(action, phase, signal) {
        if (this.config.interaction.cursorVisualization !== 'visible')
            return;
        const autoHideMs = this.config.interaction.cursorAutoHideMs;
        const move = async (point, durationMs) => {
            await this.client.cursorCommand({
                op: 'move',
                x: point.x,
                y: point.y,
                durationMs,
                autoHideMs,
                targetPid: action.targetPid,
                targetWindowNumber: action.targetWindowNumber,
                targetWindowFrame: action.targetWindowFrame,
            }, signal);
        };
        if (phase === 'after') {
            if (action.kind === 'drag')
                await this.client.cursorCommand({
                    op: 'release',
                    autoHideMs,
                    targetPid: action.targetPid,
                    targetWindowNumber: action.targetWindowNumber,
                    targetWindowFrame: action.targetWindowFrame,
                }, signal);
            return;
        }
        const start = action.kind === 'drag' ? action.from : action.to;
        if (start === undefined)
            return;
        await move(start, this.config.interaction.cursorMotionMs);
        if (this.config.interaction.cursorMotionMs > 0) {
            await delay(this.config.interaction.cursorMotionMs, undefined, { signal });
        }
        if (action.kind === 'scroll')
            return;
        await this.client.cursorCommand({
            op: 'press',
            autoHideMs,
            targetPid: action.targetPid,
            targetWindowNumber: action.targetWindowNumber,
            targetWindowFrame: action.targetWindowFrame,
            sustainedPress: action.kind === 'drag',
        }, signal);
        if (action.kind === 'drag') {
            await move(action.to, Math.max(this.config.interaction.cursorMotionMs, 240));
        }
    }
    async dispose() {
        await this.client.dispose();
    }
    async health(signal) {
        const prepared = await this.client.prepare(signal);
        const health = await this.client.invoke({ command: 'health' }, signal);
        return {
            helperVersion: health.helperVersion || prepared.version,
            helperSha256: prepared.sha256,
            accessibility: health.accessibility,
            screenRecording: health.screenRecording,
        };
    }
    async openSettings(kind, signal) {
        await this.client.invoke({ command: 'open-settings', kind }, signal);
    }
}
/** Cordis Service provider loaded by the Bundle before the model-facing consumer. */
export class MacOSComputerUseProvider extends ComputerUseService {
    static inject = ['subprocess', 'approval', 'settings', 'sessions', 'agents'];
    static Config = Config;
    settings;
    constructor(ctx, config = {}) {
        if (process.platform !== 'darwin') {
            throw new ComputerUseError('COMPUTER_UNSUPPORTED_PLATFORM', `dsh-computer-use 0.1.0 supports macOS only; current platform is ${process.platform}`);
        }
        const settings = ctx.settings.register(COMPUTER_USE_SETTINGS_NAMESPACE, Config, {
            base: config,
            applies: 'live',
            validate: (value) => { resolveConfig(value); },
        });
        const resolved = resolveConfig(settings.get());
        super(ctx, new MacOSBackend(ctx, resolved), resolved);
        this.settings = settings;
        ctx.effect(() => this.settings.watch(async (next) => {
            const candidate = resolveConfig(next);
            const backend = new MacOSBackend(ctx, candidate);
            try {
                await this.reconfigure(backend, candidate);
            }
            catch (error) {
                await backend.dispose();
                throw error;
            }
        }), 'dsh-computer-use: Settings watch');
        ctx.effect(() => ctx.on('agent/disposed', ({ agent }) => { this.releaseAgent(agent); }), 'dsh-computer-use: Agent cleanup');
    }
    /** Verify helper integrity and permissions before the service is injectable. */
    async [Service.init]() {
        await this.initialize();
    }
}
export default MacOSComputerUseProvider;
//# sourceMappingURL=macos.js.map