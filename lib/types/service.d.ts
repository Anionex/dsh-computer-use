/** Provider-independent Computer Use Service: leases, observations, staleness, confirmations, and fresh post-action state. */
import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ComputerUseBackend } from './backend.ts';
import type { ResolvedComputerUseConfig } from './config.ts';
import { type ComputerActionRequest, type ComputerActionResult, type ComputerAppSummary, type ComputerConfirmRequest, type ComputerConfirmation, type ComputerObservation, type ComputerObserveRequest, type ComputerUseContext, type ComputerUseStatus } from './types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        computerUse: ComputerUseService;
    }
}
/** Complete Service Definition plus provider-independent implementation. */
export declare class ComputerUseService extends Service {
    private backend;
    private config;
    private generation;
    private readonly agents;
    private readonly leases;
    private readonly confirmations;
    private readonly lifecycle;
    private healthState;
    /** Persist backend health facts while allowing a disabled provider to stay ready=false with a visible reason. */
    private applyHealth;
    /** Register `ctx.computerUse` using one validated backend and configuration generation. */
    constructor(ctx: Context, backend: ComputerUseBackend, config: ResolvedComputerUseConfig);
    /** Verify the active backend before consumers become injectable. */
    protected initialize(): Promise<void>;
    /** Replace the backend/config generation after a validated live Settings update. */
    protected reconfigure(backend: ComputerUseBackend, config: ResolvedComputerUseConfig): Promise<void>;
    /** Current provider and permission diagnostics. */
    status(): ComputerUseStatus;
    /** Re-run non-mutating provider health checks. */
    health(signal: AbortSignal): Promise<ComputerUseStatus>;
    /** Open the exact macOS privacy pane after an explicit Settings-page action. */
    openPermissionSettings(kind: 'accessibility' | 'screen-recording', signal: AbortSignal): Promise<void>;
    /** List bounded running applications without inspecting their UI contents. */
    listApps(context: ComputerUseContext): Promise<ComputerAppSummary[]>;
    /** Obtain a fresh, scoped observation after enforcing the app read lease. */
    observe(request: ComputerObserveRequest, context: ComputerUseContext): Promise<ComputerObservation>;
    /** Ask for a one-use token bound to an exact proposed sensitive action. */
    confirm(request: ComputerConfirmRequest, context: ComputerUseContext): Promise<ComputerConfirmation>;
    /** Execute one observation-bound action and always return a fresh post-action observation. */
    act(action: ComputerActionRequest, context: ComputerUseContext): Promise<ComputerActionResult>;
    /** Release all scoped observations and confirmations for one disposed Agent. */
    releaseAgent(agent: Agent): void;
    private state;
    private requireObservation;
    private prune;
    private capture;
    private wait;
    private clearState;
}
export default ComputerUseService;
//# sourceMappingURL=service.d.ts.map