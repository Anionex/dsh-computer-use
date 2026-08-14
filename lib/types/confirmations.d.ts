/** One-use just-in-time confirmation tokens for sensitive Computer Use actions. */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedComputerUseConfig } from './config.ts';
import { ComputerConfirmationToken, type ComputerActionRequest, type ComputerAppIdentity, type ComputerConfirmRequest, type ComputerConfirmation } from './types.ts';
/** Issues, validates, consumes, and releases scoped sensitive-action tokens. */
export declare class ComputerConfirmationManager {
    private readonly ctx;
    private readonly config;
    private readonly records;
    constructor(ctx: Context, config: () => ResolvedComputerUseConfig);
    /** Request user approval and mint one token bound to the exact action. */
    confirm(agent: Agent, app: ComputerAppIdentity, request: ComputerConfirmRequest, callId: import('@deepseek-ai/dsh-llm').CallId | undefined, signal: AbortSignal): Promise<ComputerConfirmation>;
    /** Require and consume the one matching token when an action is marked sensitive. */
    consume(agent: Agent, app: ComputerAppIdentity, action: ComputerActionRequest): void;
    /** Invalidate one pending token after target identity changes before input. */
    invalidate(agent: Agent, token: ComputerConfirmationToken | undefined): void;
    /** Release every pending token owned by one Agent. */
    releaseAgent(agent: Agent): void;
    /** Release all pending tokens on provider teardown or generation replacement. */
    clear(): void;
}
//# sourceMappingURL=confirmations.d.ts.map