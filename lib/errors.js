/** Error with a stable model-visible code and bounded public details. */
export class ComputerUseError extends Error {
    code;
    /**
     * @param code - Stable failure category.
     * @param message - Bounded correction-oriented description without UI secrets.
     * @param options - Optional original cause retained outside the model-facing message.
     */
    constructor(code, message, options) {
        super(`${code}: ${message}`, options);
        this.name = 'ComputerUseError';
        this.code = code;
    }
}
/** Convert an unknown failure into the provider-failure category without leaking unbounded native text. */
export function computerUseError(error, fallback) {
    if (error instanceof ComputerUseError)
        return error;
    const message = error instanceof Error ? error.message : String(error);
    return new ComputerUseError('COMPUTER_PROVIDER_FAILURE', `${fallback}: ${message.slice(0, 1000)}`, { cause: error });
}
//# sourceMappingURL=errors.js.map