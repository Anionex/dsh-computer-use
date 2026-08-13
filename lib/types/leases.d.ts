/** Session-sidecar read leases, durable denials, and per-turn control leases. */
import { z } from 'zod';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CallId } from '@deepseek-ai/dsh-llm';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedComputerUseConfig } from './config.ts';
import type { ComputerAppIdentity } from './types.ts';
declare const sessionIdentitySchema: z.ZodObject<{
    createdAt: z.ZodNumber;
    cwd: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Session fields that fence one sidecar row to one exact Session lifecycle. */
export type ComputerUseSessionIdentity = z.infer<typeof sessionIdentitySchema>;
declare const deniedLeaseSchema: z.ZodObject<{
    bundleId: z.ZodString;
    scope: z.ZodUnion<readonly [z.ZodLiteral<"read">, z.ZodLiteral<"control">]>;
}, z.core.$strip>;
/** One application/scope rejection that remains final for the Session lifecycle. */
export type ComputerUseDeniedLease = z.infer<typeof deniedLeaseSchema>;
/** Runtime validation for the whole-Session Computer Use sidecar row. */
export declare const computerUseSessionStateSchema: z.ZodObject<{
    session: z.ZodObject<{
        createdAt: z.ZodNumber;
        cwd: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readGrants: z.ZodArray<z.ZodString>;
    denied: z.ZodArray<z.ZodObject<{
        bundleId: z.ZodString;
        scope: z.ZodUnion<readonly [z.ZodLiteral<"read">, z.ZodLiteral<"control">]>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Plugin-owned durable authorization state for one Session lifecycle. */
export type ComputerUseSessionState = z.infer<typeof computerUseSessionStateSchema>;
/** One lifecycle-bound Computer Use sidecar record per Session id. */
export declare const computerUseStateDomainSpec: {
    name: string;
    version: number;
    tables: {
        sessions: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<SessionId, {
            session: {
                createdAt: number;
                cwd?: string | undefined;
            };
            readGrants: string[];
            denied: {
                bundleId: string;
                scope: "read" | "control";
            }[];
        }>;
    };
};
/** Source of the technical application lease used by an operation. */
export type ComputerLeaseSource = 'configured' | 'approved';
/** Applies configured app policy and routes missing leases through DSH approval. */
export declare class ComputerLeaseManager {
    private readonly ctx;
    private readonly config;
    private storage;
    private readonly storageFiber;
    private readonly decisionTails;
    private readonly mutationTails;
    private readonly controlGrants;
    constructor(ctx: Context, config: () => ResolvedComputerUseConfig);
    /** Wait for an already-composed storage-domain service to finish opening. */
    initialize(): Promise<void>;
    /** Ensure one Agent may read or control one exact running application. */
    ensure(agent: Agent, app: ComputerAppIdentity, scope: 'read' | 'control', toolName: string, callId: CallId | undefined, signal: AbortSignal): Promise<ComputerLeaseSource>;
    /** Forget process-local control grants when their Agent is disposed. */
    releaseAgent(agent: Agent): void;
    private ensureInteractive;
    private currentState;
    private prepareStorage;
    private persist;
    private storageRequired;
    private enqueueDecision;
    private enqueueMutation;
}
export {};
//# sourceMappingURL=leases.d.ts.map