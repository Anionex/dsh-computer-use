/** Agent-scoped progressive exposure for Computer Use execution Tools. */
import type { Session } from '@deepseek-ai/dsh-session';
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { Context } from 'cordis';
/** One global bootstrap retained until the current Agent loads the Skill. */
export declare const COMPUTER_USE_ACTIVATE = "computer_use_activate";
/** Activation result returned to the model. */
export interface ComputerUseActivationResult {
    activated: boolean;
    tools: string[];
}
/** Whether durable Session history proves that the bundled Skill was loaded. */
export declare function hasLoadedComputerUseSkill(session: Session): boolean;
/** Owns one progressive Tool-exposure generation. */
export declare class ComputerUseExposure {
    private readonly ctx;
    private readonly createTools;
    readonly activationTool: ToolDefinition;
    private readonly states;
    private installed;
    constructor(ctx: Context, createTools: () => ToolDefinition[]);
    /** Install lifecycle listeners and adopt existing Agents. */
    install(): () => void;
    private attach;
    private activate;
    private detach;
    private disposeStates;
    private disposeState;
}
//# sourceMappingURL=exposure.d.ts.map