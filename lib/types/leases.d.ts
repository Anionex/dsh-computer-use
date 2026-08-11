/** Durable per-Session read leases and per-turn control leases. */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CallId } from '@deepseek-ai/dsh-llm';
import type { Context } from 'cordis';
import type { ResolvedComputerUseConfig } from './config.ts';
import type { ComputerAppIdentity } from './types.ts';
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /** A granted Computer Use application lease; read lasts the Session and control the named turn. */
        'computer-use/lease': {
            bundleId: string;
            scope: 'read' | 'control';
            turn?: number;
            source: 'approval';
        };
        /** A rejected Computer Use application approval; the same scope is not asked again in this Session. */
        'computer-use/denied': {
            bundleId: string;
            scope: 'read' | 'control';
        };
    }
}
/** Source of the technical application lease used by an operation. */
export type ComputerLeaseSource = 'configured' | 'approved';
/** Applies configured app policy and routes missing leases through DSH approval. */
export declare class ComputerLeaseManager {
    private readonly ctx;
    private readonly config;
    constructor(ctx: Context, config: () => ResolvedComputerUseConfig);
    /** Ensure one Agent may read or control one exact running application. */
    ensure(agent: Agent, app: ComputerAppIdentity, scope: 'read' | 'control', toolName: string, callId: CallId | undefined, signal: AbortSignal): Promise<ComputerLeaseSource>;
}
//# sourceMappingURL=leases.d.ts.map