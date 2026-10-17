export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A payment was rejected for a business reason (no money moved).
 * The transaction is recorded as FAILED with this code.
 */
export class PaymentRejectedError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 422, details);
  }
}

/** A bug: the code asked the ledger to do something that can never be valid. */
export class LedgerInvariantError extends AppError {
  constructor(message: string, details?: unknown) {
    super('LEDGER_INVARIANT_VIOLATION', message, 500, details);
  }
}
