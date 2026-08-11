/** Shared DSH approval-policy read for Computer Use permission paths. */
/**
 * The session's effective DSH approval policy: a logged override, else the
 * approval plugin's configured default.
 * @param ctx - context with the approval service injected.
 * @param agent - the agent whose session policy applies.
 * @returns `'never'` when every approval ask would auto-reject without a prompt.
 */
export function approvalPolicy(ctx, agent) {
    return ctx.approval.overrideOf(agent.session) ?? ctx.approval.config.policy ?? 'ask';
}
//# sourceMappingURL=approval-policy.js.map