export const validateBetAmount = (amount: number, context: string): void => {
  if (!Number.isFinite(amount)) {
    throw new Error(`${context}: bet amount must be finite`);
  }
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`${context}: bet amount must be a safe integer`);
  }
  if (amount <= 0) {
    throw new Error(`${context}: bet amount must be > 0`);
  }
  if (amount > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${context}: bet amount exceeds safe integer range`);
  }
};
