/** One-use just-in-time confirmation tokens for sensitive Computer Use actions. */
import { createHash, randomUUID } from 'node:crypto';
import { approvalPolicy } from "./approval-policy.js";
import { ComputerUseError } from "./errors.js";
import { ComputerConfirmationToken, } from "./types.js";
function stable(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stable).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
}
function actionHash(action) {
    const { confirmationToken: _token, ...rest } = action;
    return createHash('sha256').update(stable(rest)).digest('hex');
}
/** Issues, validates, consumes, and releases scoped sensitive-action tokens. */
export class ComputerConfirmationManager {
    ctx;
    config;
    records = new Map();
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
    }
    /** Request user approval and mint one token bound to the exact action. */
    async confirm(agent, app, request, callId, signal) {
        if (approvalPolicy(this.ctx, agent) === 'never') {
            throw new ComputerUseError('COMPUTER_CONFIRMATION_REQUIRED', 'sensitive action confirmation is blocked because approval prompts are disabled in this Session (approval/policy: never); do not execute the action, and ask the user to switch the permission preset to one with approval ask or run it manually');
        }
        const outcome = await this.ctx.approval.request({
            agent,
            toolName: 'computer_confirm',
            ...(callId === undefined ? {} : { callId }),
            reason: `${request.reason} Target: ${request.target}.${request.dataSummary === undefined ? '' : ` Data: ${request.dataSummary}.`}`,
            signal,
        });
        if (outcome === 'cancelled')
            throw new ComputerUseError('COMPUTER_CANCELLED', 'sensitive action confirmation was cancelled');
        if (outcome !== 'allowed-once') {
            throw new ComputerUseError('COMPUTER_CONFIRMATION_REQUIRED', `sensitive action was not confirmed (${outcome})`);
        }
        const token = ComputerConfirmationToken(randomUUID());
        const expiresAt = Date.now() + this.config().confirmationTtlMs;
        let agentRecords = this.records.get(agent);
        if (agentRecords === undefined) {
            agentRecords = new Map();
            this.records.set(agent, agentRecords);
        }
        agentRecords.set(token, {
            app,
            observationId: request.action.observationId,
            actionHash: actionHash(request.action),
            expiresAt,
        });
        return { token, observationId: request.action.observationId, app, expiresAt: new Date(expiresAt).toISOString() };
    }
    /** Require and consume the one matching token when an action is marked sensitive. */
    consume(agent, app, action) {
        if (action.sensitive !== true) {
            if (action.confirmationToken !== undefined) {
                throw new ComputerUseError('COMPUTER_CONFIRMATION_REQUIRED', 'confirmationToken is valid only when sensitive is true');
            }
            return;
        }
        const token = action.confirmationToken;
        if (token === undefined) {
            throw new ComputerUseError('COMPUTER_CONFIRMATION_REQUIRED', 'sensitive action requires a token from computer_confirm');
        }
        const agentRecords = this.records.get(agent);
        const record = agentRecords?.get(token);
        if (record === undefined) {
            throw new ComputerUseError('COMPUTER_CONFIRMATION_REQUIRED', 'confirmation token is unknown, expired, or already consumed');
        }
        agentRecords?.delete(token);
        if (record.expiresAt < Date.now()) {
            throw new ComputerUseError('COMPUTER_CONFIRMATION_REQUIRED', 'confirmation token expired');
        }
        if (record.app.bundleId !== app.bundleId || record.app.pid !== app.pid
            || record.observationId !== action.observationId || record.actionHash !== actionHash(action)) {
            throw new ComputerUseError('COMPUTER_CONFIRMATION_REQUIRED', 'confirmation token does not match this app, observation, or action');
        }
    }
    /** Release every pending token owned by one Agent. */
    releaseAgent(agent) {
        this.records.delete(agent);
    }
    /** Release all pending tokens on provider teardown or generation replacement. */
    clear() {
        this.records.clear();
    }
}
//# sourceMappingURL=confirmations.js.map