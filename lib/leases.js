/** Durable per-Session read leases and per-turn control leases. */
import { ComputerUseError } from "./errors.js";
function currentTurn(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === 'turn/end')
            return undefined;
        if (event?.type === 'turn/start')
            return event.data.turn;
    }
    return undefined;
}
/** Applies configured app policy and routes missing leases through DSH approval. */
export class ComputerLeaseManager {
    ctx;
    config;
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
    }
    /** Ensure one Agent may read or control one exact running application. */
    async ensure(agent, app, scope, toolName, callId, signal) {
        const configured = this.config().grants.find(grant => grant.bundleId === app.bundleId);
        if (configured?.[scope] === true)
            return 'configured';
        const turn = currentTurn(agent.session.events);
        if (turn === undefined) {
            throw new ComputerUseError('COMPUTER_PERMISSION_REQUIRED', `${scope} access for ${app.name} must be requested inside an open Agent turn`);
        }
        const existing = agent.session.events.some((event) => {
            if (event.type !== 'computer-use/lease')
                return false;
            if (event.data.bundleId !== app.bundleId || event.data.scope !== scope)
                return false;
            return scope === 'read' || event.data.turn === turn;
        });
        if (existing)
            return 'approved';
        const outcome = await this.ctx.approval.request({
            agent,
            toolName,
            ...(callId === undefined ? {} : { callId }),
            reason: scope === 'read'
                ? `Allow this Agent to inspect the Accessibility state${scope === 'read' ? ' and requested screenshot' : ''} of ${app.name} (${app.bundleId}) for this Session.`
                : `Allow this Agent to send UI input to ${app.name} (${app.bundleId}) for the current turn.`,
            signal,
        });
        if (outcome === 'cancelled') {
            throw new ComputerUseError('COMPUTER_CANCELLED', `${scope} access request for ${app.name} was cancelled`);
        }
        if (outcome !== 'allowed-once') {
            throw new ComputerUseError('COMPUTER_PERMISSION_REQUIRED', `${scope} access for ${app.name} was not granted (${outcome})`);
        }
        agent.session.append('computer-use/lease', {
            bundleId: app.bundleId,
            scope,
            ...(scope === 'control' ? { turn } : {}),
            source: 'approval',
        });
        return 'approved';
    }
}
//# sourceMappingURL=leases.js.map