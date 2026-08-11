/** DSH Computer Use model-facing consumer and progressive Skill bundle. */
import { Service } from 'cordis';
import { Config } from "./config.js";
import { ComputerUseExposure } from "./exposure.js";
import { MacOSComputerUseProvider } from "./providers/macos.js";
import { COMPUTER_USE_SKILL } from "./skill.js";
import { createComputerUseTools } from "./tools.js";
import { installComputerUseWeb } from "./web.js";
export { Config } from "./config.js";
export * from "./errors.js";
export * from "./service.js";
export * from "./types.js";
/** Register the portable Skill, bootstrap, Agent-scoped Tools, and optional Web diagnostics. */
export function installComputerUseConsumer(ctx) {
    const exposure = new ComputerUseExposure(ctx, () => createComputerUseTools(ctx.computerUse));
    let activation;
    let skill;
    let exposureDispose;
    try {
        activation = ctx.tools.register(exposure.activationTool);
        skill = ctx.skills.register(COMPUTER_USE_SKILL);
        exposureDispose = exposure.install();
        installComputerUseWeb(ctx);
    }
    catch (error) {
        exposureDispose?.();
        skill?.();
        activation?.();
        throw error;
    }
    return () => {
        exposureDispose?.();
        activation?.();
        skill?.();
    };
}
/** macOS provider plus the portable Skill, scoped Tools, and optional Web diagnostics. */
export class ComputerUseBundle extends MacOSComputerUseProvider {
    static inject = ['subprocess', 'approval', 'settings', 'agents', 'tools', 'skills'];
    static Config = Config;
    consumerDispose;
    constructor(ctx, config = {}) {
        super(ctx, config);
        ctx.effect(() => () => {
            this.consumerDispose?.();
            this.consumerDispose = undefined;
        }, 'dsh-computer-use: consumer lifecycle');
    }
    /** Publish model-facing capabilities only after provider integrity and health pass. */
    async [Service.init]() {
        await super[Service.init]();
        this.consumerDispose = installComputerUseConsumer(this.ctx);
    }
}
export default ComputerUseBundle;
//# sourceMappingURL=index.js.map