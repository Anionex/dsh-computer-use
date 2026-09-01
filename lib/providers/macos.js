/** macOS Accessibility/CoreGraphics/ScreenCaptureKit provider for `ctx.computerUse`. */
import { setTimeout as delay } from 'node:timers/promises';
import { Service } from '@deepseek-ai/cordis';
import { Config, COMPUTER_USE_SETTINGS_NAMESPACE, resolveConfig, } from "../config.js";
import { ComputerUseService } from "../service.js";
import { NativeHelperClient } from "./native-helper.js";
import { UnsupportedPlatformBackend } from "./unsupported.js";
function createBackend(ctx, config) {
    return process.platform === 'darwin'
        ? new MacOSBackend(ctx, config)
        : new UnsupportedPlatformBackend(process.platform);
}
/** Fixed-command native backend. */
export class MacOSBackend {
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
    async activateForCursor(app, expectedStateHash, options, signal) {
        return await this.client.invoke({
            command: 'activate-for-cursor',
            app,
            expectedStateHash,
            options,
            actionTimeoutMs: this.config.actionTimeoutMs,
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
            return { visible: false, reason: 'the agent cursor is disabled by configuration' };
        // The overlay answers per command; the least visible outcome wins, because
        // a cursor that vanished partway through is a cursor the user cannot follow.
        let outcome = { visible: true };
        const record = (response) => {
            if (!response.visible && outcome.visible)
                outcome = response;
        };
        const autoHideMs = this.config.interaction.cursorAutoHideMs;
        const move = async (point) => {
            record(await this.client.cursorCommand({
                op: 'move',
                x: point.x,
                y: point.y,
                speedPxPerSecond: this.config.interaction.cursorSpeedPxPerSecond,
                accelerationPxPerSecondSquared: this.config.interaction.cursorAccelerationPxPerSecondSquared,
                // The after phase arms the configured timeout once native input has
                // completed. Hiding during travel or dwell would invalidate press.
                autoHideMs: 0,
                targetPid: action.targetPid,
                targetWindowNumber: action.targetWindowNumber,
                targetWindowFrame: action.targetWindowFrame,
            }, signal));
        };
        if (phase === 'after') {
            // Every action validates the bound target after native input. Only drag
            // needs release semantics; click and scroll use a side-effect-free check.
            record(await this.client.cursorCommand({
                op: action.kind === 'drag' ? 'release' : 'validate',
                autoHideMs,
                targetPid: action.targetPid,
                targetWindowNumber: action.targetWindowNumber,
                targetWindowFrame: action.targetWindowFrame,
            }, signal));
            return outcome;
        }
        if (phase === 'during') {
            if (action.kind !== 'drag')
                return { visible: false, reason: 'only drag has a during-action cursor phase' };
            await move(action.to);
            return outcome;
        }
        const start = action.kind === 'drag' ? action.from : action.to;
        if (start === undefined)
            return { visible: false, reason: 'this action has no cursor position to show' };
        // A move response means the native overlay reached its destination. Keep
        // the configurable dwell after arrival and before the visual/native press.
        await move(start);
        if (!outcome.visible || action.kind === 'scroll')
            return outcome;
        if (this.config.interaction.cursorClickDelayMs > 0) {
            await delay(this.config.interaction.cursorClickDelayMs, undefined, { signal });
        }
        record(await this.client.cursorCommand({
            op: 'press',
            autoHideMs: 0,
            targetPid: action.targetPid,
            targetWindowNumber: action.targetWindowNumber,
            targetWindowFrame: action.targetWindowFrame,
            sustainedPress: action.kind === 'drag',
        }, signal));
        return outcome;
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
        const settings = ctx.settings.register(COMPUTER_USE_SETTINGS_NAMESPACE, Config, {
            base: config,
            applies: 'live',
            validate: (value) => { resolveConfig(value); },
        });
        const resolved = resolveConfig(settings.get());
        super(ctx, createBackend(ctx, resolved), resolved);
        this.settings = settings;
        if (process.platform !== 'darwin') {
            ctx.logger.warn('dsh-computer-use: supports macOS only; Computer Use Tools are disabled on %s', process.platform);
        }
        ctx.effect(() => this.settings.watch(async (next) => {
            const candidate = resolveConfig(next);
            const backend = createBackend(ctx, candidate);
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