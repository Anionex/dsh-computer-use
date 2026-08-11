/** DSH Computer Use model-facing consumer and progressive Skill bundle. */
import { Service, type Context } from 'cordis';
import { type ComputerUseConfig } from './config.ts';
import { MacOSComputerUseProvider } from './providers/macos.ts';
export { Config } from './config.ts';
export * from './errors.ts';
export * from './service.ts';
export * from './types.ts';
/** Register the portable Skill, bootstrap, Agent-scoped Tools, and optional Web diagnostics. */
export declare function installComputerUseConsumer(ctx: Context): () => void;
/** macOS provider plus the portable Skill, scoped Tools, and optional Web diagnostics. */
export declare class ComputerUseBundle extends MacOSComputerUseProvider {
    static inject: string[];
    static Config: import("schemastery").default<ComputerUseConfig>;
    private consumerDispose;
    constructor(ctx: Context, config?: ComputerUseConfig);
    /** Publish model-facing capabilities only after provider integrity and health pass. */
    protected [Service.init](): Promise<void>;
}
export default ComputerUseBundle;
//# sourceMappingURL=index.d.ts.map