/** Shared DSH approval-policy read for Computer Use permission paths. */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval';
import type { Context } from 'cordis';
/**
 * The session's effective DSH approval policy: a logged override, else the
 * approval plugin's configured default.
 * @param ctx - context with the approval service injected.
 * @param agent - the agent whose session policy applies.
 * @returns `'never'` when every approval ask would auto-reject without a prompt.
 */
export declare function approvalPolicy(ctx: Context, agent: Agent): ApprovalPolicy;
//# sourceMappingURL=approval-policy.d.ts.map