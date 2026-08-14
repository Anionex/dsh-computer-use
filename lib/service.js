/** Provider-independent Computer Use Service: leases, observations, staleness, confirmations, and fresh post-action state. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Service } from '@deepseek-ai/cordis';
import { allocateScreenshotPath, describeScreenshot } from "./artifacts.js";
import { ComputerConfirmationManager } from "./confirmations.js";
import { diffElements } from "./diff.js";
import { ComputerUseError, computerUseError } from "./errors.js";
import { ComputerLeaseManager } from "./leases.js";
import { describeComputerTarget, resolveComputerTarget, } from "./target-resolver.js";
import { ComputerObservationId, ComputerTargetHandle, } from "./types.js";
function publicElements(observation) {
    const targets = new Map();
    const elements = observation.elements.map((backendElement) => {
        const { locator: _locator, nativeIdentifier: _nativeIdentifier, ...element } = backendElement;
        const targetHandle = ComputerTargetHandle(randomUUID());
        targets.set(targetHandle, describeComputerTarget(backendElement, observation));
        return { ...element, targetHandle };
    });
    return { elements, targets };
}
function matchesWait(observation, action) {
    const condition = action.condition;
    if (condition.text !== undefined && !observation.treeText.toLocaleLowerCase().includes(condition.text.toLocaleLowerCase()))
        return false;
    if (condition.elementRole !== undefined && !observation.elements.some(element => element.role === condition.elementRole))
        return false;
    if (condition.elementTitle !== undefined && !observation.elements.some(element => element.title === condition.elementTitle || element.label === condition.elementTitle))
        return false;
    return condition.text !== undefined || condition.elementRole !== undefined || condition.elementTitle !== undefined;
}
function targetIndex(action) {
    switch (action.kind) {
        case 'click':
        case 'scroll': return action.elementIndex;
        case 'set-value':
        case 'perform-action': return action.elementIndex;
        case 'type-text':
        case 'press-key':
        case 'drag':
        case 'wait': return undefined;
    }
}
function targetHandle(action) {
    switch (action.kind) {
        case 'click':
        case 'scroll':
        case 'set-value':
        case 'perform-action': return action.targetHandle;
        case 'type-text':
        case 'press-key':
        case 'drag':
        case 'wait': return undefined;
    }
}
function allowsTargetRebind(action) {
    switch (action.kind) {
        case 'click':
        case 'scroll':
        case 'set-value':
        case 'perform-action': return action.allowRebind === true;
        case 'type-text':
        case 'press-key':
        case 'drag':
        case 'wait': return false;
    }
}
function requiresElement(action) {
    return action.kind === 'set-value' || action.kind === 'perform-action';
}
function requiresPointerInput(action, element) {
    switch (action.kind) {
        case 'click':
            if (action.x !== undefined || action.y !== undefined)
                return true;
            return element !== undefined
                && !element.actions.includes('AXPress')
                && action.allowCoordinateFallback === true;
        case 'scroll':
        case 'drag': return true;
        case 'set-value':
        case 'type-text':
        case 'press-key':
        case 'perform-action': return false;
    }
}
function requiresForegroundPermission(action) {
    return action.kind === 'perform-action' && action.action === 'AXRaise';
}
function cursorAction(action, element, window, app) {
    if (window?.id === undefined)
        return undefined;
    const target = {
        targetPid: app.pid,
        targetWindowNumber: window.id,
        targetWindowFrame: { ...window.frame },
    };
    const elementPoint = element?.frame === undefined
        ? undefined
        : {
            x: element.frame.x + element.frame.width / 2,
            y: element.frame.y + element.frame.height / 2,
        };
    const coordinateSpace = action.kind === 'click' || action.kind === 'scroll' || action.kind === 'drag'
        ? action.coordinateSpace
        : undefined;
    const windowPoint = (x, y) => {
        if (x === undefined || y === undefined || window === undefined)
            return undefined;
        return coordinateSpace === 'screen' ? { x, y } : { x: window.frame.x + x, y: window.frame.y + y };
    };
    switch (action.kind) {
        case 'click':
        case 'scroll': {
            const point = elementPoint ?? windowPoint(action.x, action.y);
            return point === undefined ? undefined : { kind: action.kind, to: point, ...target };
        }
        case 'drag': {
            const from = windowPoint(action.fromX, action.fromY);
            const to = windowPoint(action.toX, action.toY);
            return from === undefined || to === undefined ? undefined : { kind: 'drag', from, to, ...target };
        }
        case 'set-value':
        case 'type-text':
        case 'press-key':
        case 'perform-action': return undefined;
    }
}
/** Complete Service Definition plus provider-independent implementation. */
export class ComputerUseService extends Service {
    backend;
    config;
    generation = 1;
    agents = new Map();
    leases;
    confirmations;
    lifecycle = new AbortController();
    healthState = {
        ready: false,
        accessibility: 'unavailable',
        screenRecording: 'unavailable',
    };
    /** Register `ctx.computerUse` using one validated backend and configuration generation. */
    constructor(ctx, backend, config) {
        super(ctx, 'computerUse');
        this.backend = backend;
        this.config = config;
        this.leases = new ComputerLeaseManager(ctx, () => this.config);
        this.confirmations = new ComputerConfirmationManager(ctx, () => this.config);
        ctx.effect(() => async () => {
            this.lifecycle.abort();
            this.clearState();
            await this.backend.dispose();
        }, 'dsh-computer-use: service lifecycle');
    }
    /** Verify the active backend before consumers become injectable. */
    async initialize() {
        try {
            await this.leases.initialize();
            const health = await this.backend.health(this.lifecycle.signal);
            this.healthState = { ready: true, ...health };
        }
        catch (error) {
            const failure = computerUseError(error, 'Computer Use provider initialization failed');
            this.healthState = {
                ready: false,
                accessibility: 'unavailable',
                screenRecording: 'unavailable',
                lastError: failure.message,
            };
            throw failure;
        }
    }
    /** Replace the backend/config generation after a validated live Settings update. */
    async reconfigure(backend, config) {
        const health = await backend.health(this.lifecycle.signal);
        const previous = this.backend;
        this.backend = backend;
        this.config = config;
        this.generation += 1;
        this.clearState();
        this.healthState = { ready: true, ...health };
        await previous.dispose();
    }
    /** Current provider and permission diagnostics. */
    status() {
        return {
            platform: process.platform,
            provider: 'macos-ax',
            generation: this.generation,
            helperPath: this.backend.helperPath,
            ...this.healthState,
        };
    }
    /** Re-run non-mutating provider health checks. */
    async health(signal) {
        try {
            const health = await this.backend.health(AbortSignal.any([signal, this.lifecycle.signal]));
            this.healthState = { ready: true, ...health };
        }
        catch (error) {
            const failure = computerUseError(error, 'Computer Use health check failed');
            this.healthState = { ...this.healthState, ready: false, lastError: failure.message };
            throw failure;
        }
        return this.status();
    }
    /** Open the exact macOS privacy pane after an explicit Settings-page action. */
    async openPermissionSettings(kind, signal) {
        await this.backend.openSettings(kind, AbortSignal.any([signal, this.lifecycle.signal]));
    }
    /** List bounded running applications without inspecting their UI contents. */
    async listApps(context) {
        return await this.backend.listApps(AbortSignal.any([context.signal, this.lifecycle.signal]));
    }
    /** Obtain a fresh, scoped observation after enforcing the app read lease. */
    async observe(request, context) {
        const signal = AbortSignal.any([context.signal, this.lifecycle.signal]);
        const app = await this.backend.resolveApp(request.app, signal);
        await this.leases.ensure(context.agent, app, 'read', 'computer_observe', context.callId, signal);
        return await this.capture(app, request, context, 'computer_observe');
    }
    /** Ask for a one-use token bound to an exact proposed sensitive action. */
    async confirm(request, context) {
        const stored = this.requireObservation(request.action.observationId, context.agent);
        return await this.confirmations.confirm(context.agent, stored.backend.app, request, context.callId, AbortSignal.any([context.signal, this.lifecycle.signal]));
    }
    /** Execute one observation-bound action and always return a fresh post-action observation. */
    async act(action, context) {
        const signal = AbortSignal.any([context.signal, this.lifecycle.signal]);
        const stored = this.requireObservation(action.observationId, context.agent);
        if (action.kind === 'wait')
            return await this.wait(stored, action, context, signal);
        const index = targetIndex(action);
        const handle = targetHandle(action);
        const originalElement = index === undefined ? undefined : stored.backend.elements.find(candidate => candidate.index === index);
        if (index !== undefined && originalElement === undefined) {
            throw new ComputerUseError('COMPUTER_ELEMENT_UNAVAILABLE', `element ${index} is not part of observation ${String(action.observationId)}`);
        }
        if (allowsTargetRebind(action) && handle === undefined) {
            throw new ComputerUseError('COMPUTER_TARGET_UNAVAILABLE', 'allowRebind requires a targetHandle from the referenced observation');
        }
        const descriptor = handle === undefined ? undefined : stored.targets.get(handle);
        if (handle !== undefined && descriptor === undefined) {
            throw new ComputerUseError('COMPUTER_TARGET_UNAVAILABLE', 'targetHandle is unknown or does not belong to the referenced observation');
        }
        if (descriptor !== undefined && index !== undefined && (descriptor.locator.length !== originalElement?.locator.length
            || !descriptor.locator.every((part, position) => part === originalElement.locator[position]))) {
            throw new ComputerUseError('COMPUTER_TARGET_UNAVAILABLE', 'elementIndex and targetHandle select different elements');
        }
        const selectedOriginalElement = originalElement ?? (descriptor === undefined
            ? undefined
            : stored.backend.elements.find(candidate => candidate.locator.length === descriptor.locator.length
                && candidate.locator.every((part, position) => part === descriptor.locator[position])));
        if (descriptor !== undefined && selectedOriginalElement === undefined) {
            throw new ComputerUseError('COMPUTER_TARGET_UNAVAILABLE', 'targetHandle no longer has provider evidence in the referenced observation');
        }
        if (requiresElement(action) && selectedOriginalElement === undefined) {
            throw new ComputerUseError('COMPUTER_ELEMENT_UNAVAILABLE', `${action.kind} requires elementIndex or targetHandle`);
        }
        if (requiresPointerInput(action, selectedOriginalElement) && this.config.interaction.pointerInputPolicy === 'deny') {
            throw new ComputerUseError('COMPUTER_ACTION_BLOCKED', `${action.kind} requires target-process pointer input, which interaction.pointerInputPolicy denies; use an Accessibility action or enable targeted pointer input in host Settings`);
        }
        if (requiresForegroundPermission(action) && this.config.interaction.focusPolicy === 'preserve') {
            throw new ComputerUseError('COMPUTER_ACTION_BLOCKED', 'AXRaise may raise the target window, which interaction.focusPolicy preserve denies; enable explicit activation in host Settings before using this action');
        }
        await this.leases.ensure(context.agent, stored.backend.app, 'control', `computer_${action.kind}`, context.callId, signal);
        let actionObservation = stored.backend;
        let element = selectedOriginalElement;
        let resolution = selectedOriginalElement === undefined
            ? undefined
            : { mode: 'exact-locator', confidence: 1, candidateCount: 1, targetChanged: false };
        if (descriptor !== undefined) {
            const fresh = await this.backend.observe(stored.backend.app, {
                screenshot: 'none',
                maxNodes: this.config.maxNodes,
                maxDepth: this.config.maxDepth,
                maxTextBytes: this.config.maxTextBytes,
            }, signal);
            const resolved = resolveComputerTarget(stored.backend, fresh, descriptor, allowsTargetRebind(action));
            actionObservation = resolved.observation;
            element = resolved.element;
            resolution = resolved.resolution;
            if (action.sensitive === true && resolution.targetChanged) {
                this.confirmations.invalidate(context.agent, action.confirmationToken);
                throw new ComputerUseError('COMPUTER_TARGET_REBIND_REQUIRES_CONFIRMATION', 'the sensitive target rebound to a fresh element; observe the current UI and request a new one-use confirmation before acting');
            }
        }
        this.confirmations.consume(context.agent, stored.backend.app, action);
        const visualization = cursorAction(action, element, actionObservation.window, actionObservation.app);
        let cursorStarted = false;
        if (visualization !== undefined && this.config.interaction.cursorVisualization === 'visible') {
            try {
                await this.backend.visualizeCursor(visualization, 'before', signal);
                cursorStarted = true;
            }
            catch {
                // The overlay is presentation-only; native input remains authoritative.
            }
        }
        let outcome;
        try {
            outcome = await this.backend.act({
                action,
                app: actionObservation.app,
                expectedStateHash: actionObservation.stateHash,
                interaction: this.config.interaction,
                ...(element === undefined ? {} : { element }),
                ...(actionObservation.window === undefined ? {} : { window: actionObservation.window }),
            }, signal);
        }
        catch (error) {
            throw computerUseError(error, `Computer Use ${action.kind} failed`);
        }
        finally {
            if (cursorStarted && visualization !== undefined) {
                try {
                    await this.backend.visualizeCursor(visualization, 'after', signal);
                }
                catch {
                    // The overlay is presentation-only; native input remains authoritative.
                }
            }
        }
        const started = Date.now();
        let latest;
        do {
            if (this.config.settleMs > 0)
                await delay(this.config.settleMs, undefined, { signal });
            latest = await this.backend.observe(stored.backend.app, {
                screenshot: 'none',
                maxNodes: this.config.maxNodes,
                maxDepth: this.config.maxDepth,
                maxTextBytes: this.config.maxTextBytes,
            }, signal);
            if (latest.stateHash !== actionObservation.stateHash)
                break;
        } while (Date.now() - started < this.config.maxSettleMs);
        const observation = await this.capture(stored.backend.app, { app: { bundleId: stored.backend.app.bundleId, pid: stored.backend.app.pid }, screenshot: stored.public.screenshot === undefined ? 'none' : 'optional' }, context, 'computer_action', latest);
        return {
            action: action.kind,
            channel: outcome.channel,
            activation: outcome.activation,
            pointerInput: outcome.pointerInput,
            pointerRouting: outcome.pointerRouting,
            ...(resolution === undefined ? {} : { resolution }),
            observation,
        };
    }
    /** Release all scoped observations and confirmations for one disposed Agent. */
    releaseAgent(agent) {
        this.agents.delete(agent);
        this.leases.releaseAgent(agent);
        this.confirmations.releaseAgent(agent);
    }
    state(agent) {
        let state = this.agents.get(agent);
        if (state === undefined) {
            state = { observations: new Map(), latestByApp: new Map() };
            this.agents.set(agent, state);
        }
        return state;
    }
    requireObservation(id, agent) {
        this.prune(agent);
        const stored = this.state(agent).observations.get(id);
        if (stored === undefined || stored.generation !== this.generation) {
            throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', `observation ${String(id)} is unknown, expired, or belongs to another provider generation`);
        }
        return stored;
    }
    prune(agent) {
        const state = this.agents.get(agent);
        if (state === undefined)
            return;
        const now = Date.now();
        for (const [id, stored] of state.observations) {
            if (Date.parse(stored.public.expiresAt) <= now || stored.generation !== this.generation)
                state.observations.delete(id);
        }
        for (const [app, id] of state.latestByApp) {
            if (!state.observations.has(id))
                state.latestByApp.delete(app);
        }
    }
    async capture(app, request, context, sourceTool, preObserved) {
        const signal = AbortSignal.any([context.signal, this.lifecycle.signal]);
        const screenshot = request.screenshot ?? 'optional';
        const screenshotPath = screenshot === 'none'
            ? undefined
            : await allocateScreenshotPath(context.workspace, this.config.artifactRoot, context.agent.session.id);
        const backend = preObserved !== undefined && screenshot === 'none'
            ? preObserved
            : await this.backend.observe(app, {
                screenshot,
                ...(screenshotPath === undefined ? {} : { screenshotPath }),
                maxNodes: this.config.maxNodes,
                maxDepth: this.config.maxDepth,
                maxTextBytes: this.config.maxTextBytes,
            }, signal);
        if (backend.app.bundleId !== app.bundleId || backend.app.pid !== app.pid) {
            throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', 'the selected application restarted or resolved to a different process');
        }
        const state = this.state(context.agent);
        this.prune(context.agent);
        const key = `${app.bundleId}:${app.pid}`;
        const previousId = state.latestByApp.get(key);
        const previous = previousId === undefined ? undefined : state.observations.get(previousId);
        const projected = publicElements(backend);
        const elements = projected.elements;
        const full = request.full === true || previous === undefined;
        const createdAt = Date.now();
        const observationId = ComputerObservationId(randomUUID());
        const artifact = backend.screenshot === undefined
            ? undefined
            : await describeScreenshot(backend.screenshot.path, backend.screenshot.width, backend.screenshot.height, this.config.maxScreenshotBytes, sourceTool);
        const observation = {
            observationId,
            app: backend.app,
            createdAt: new Date(createdAt).toISOString(),
            expiresAt: this.config.observationTtlMs === 0
                ? '9999-12-31T23:59:59.999Z'
                : new Date(createdAt + this.config.observationTtlMs).toISOString(),
            frontmost: backend.frontmost,
            ...(backend.window === undefined ? {} : { window: backend.window }),
            tree: {
                mode: full ? 'full' : 'diff',
                text: full ? backend.treeText : diffElements(previous.public.elements, elements, this.config.maxTextBytes),
                truncated: backend.truncated,
            },
            elements,
            ...(artifact === undefined ? {} : { screenshot: artifact }),
            permissions: backend.permissions,
        };
        state.observations.set(observationId, { public: observation, backend, targets: projected.targets, generation: this.generation });
        state.latestByApp.set(key, observationId);
        while (state.observations.size > 64) {
            const oldest = state.observations.keys().next().value;
            if (oldest === undefined)
                break;
            state.observations.delete(oldest);
        }
        return observation;
    }
    async wait(stored, action, context, signal) {
        await this.leases.ensure(context.agent, stored.backend.app, 'read', 'computer_wait', context.callId, signal);
        const timeoutMs = action.timeoutMs ?? this.config.maxSettleMs;
        if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > this.config.maxSettleMs) {
            throw new ComputerUseError('COMPUTER_TIMEOUT', `wait timeout must be between 100 and ${this.config.maxSettleMs} milliseconds`);
        }
        const deadline = Date.now() + timeoutMs;
        let latest = stored.backend;
        while (!matchesWait(latest, action)) {
            if (Date.now() >= deadline)
                throw new ComputerUseError('COMPUTER_TIMEOUT', 'wait condition was not met before the configured deadline');
            await delay(Math.min(this.config.settleMs || 100, Math.max(1, deadline - Date.now())), undefined, { signal });
            latest = await this.backend.observe(stored.backend.app, {
                screenshot: 'none',
                maxNodes: this.config.maxNodes,
                maxDepth: this.config.maxDepth,
                maxTextBytes: this.config.maxTextBytes,
            }, signal);
        }
        const observation = await this.capture(stored.backend.app, { app: { bundleId: stored.backend.app.bundleId, pid: stored.backend.app.pid }, screenshot: stored.public.screenshot === undefined ? 'none' : 'optional' }, context, 'computer_action', latest);
        return {
            action: 'wait',
            channel: 'wait',
            activation: 'not-requested',
            pointerInput: false,
            pointerRouting: 'none',
            observation,
        };
    }
    clearState() {
        this.agents.clear();
        this.confirmations.clear();
    }
}
export default ComputerUseService;
//# sourceMappingURL=service.js.map