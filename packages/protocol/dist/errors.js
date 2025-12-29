/**
 * Protocol-specific error types.
 * Thrown when decoding invalid binary data from the chain.
 */
export class ProtocolError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProtocolError';
    }
}
//# sourceMappingURL=errors.js.map