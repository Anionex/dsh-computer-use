/** Optional Web Settings and provider-health route. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from 'cordis';
import { type ComputerUseConfig } from './config.ts';
import type { ComputerUseStatus } from './types.ts';
/** Exact same-origin Settings endpoint. */
export declare const COMPUTER_USE_SETTINGS_ROUTE = "/_dsh/computer-use/settings";
/** Browser-safe Settings snapshot. */
export interface ComputerUseSettingsSnapshot {
    schemaVersion: 1;
    writable: boolean;
    settings: {
        value: ComputerUseConfig;
        user?: unknown;
        base?: unknown;
        revision: number;
        applies: 'live';
    };
    provider: ComputerUseStatus;
}
/** Same-origin backend used by the optional client Settings section. */
export declare class ComputerUseWebBackend {
    private readonly ctx;
    constructor(ctx: Context);
    /** Current browser-safe Settings and health state. */
    snapshot(): ComputerUseSettingsSnapshot;
    /** Handle one Settings request. */
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
/** Attach the optional route when a Web host is present. */
export declare function installComputerUseWeb(ctx: Context): void;
//# sourceMappingURL=web.d.ts.map