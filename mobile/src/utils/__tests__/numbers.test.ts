import { parseNumeric } from "../numbers";

describe("parseNumeric", () => {
  it("parses finite numbers", () => {
    expect(parseNumeric(42)).toBe(42);
    expect(parseNumeric(-3.5)).toBe(-3.5);
  });

  it("parses numeric strings", () => {
    expect(parseNumeric("12")).toBe(12);
    expect(parseNumeric(" 7.25 ")).toBe(7.25);
  });

  it("returns null for invalid values", () => {
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric("abc")).toBeNull();
    expect(parseNumeric(NaN)).toBeNull();
    expect(parseNumeric(Infinity)).toBeNull();
    expect(parseNumeric(undefined)).toBeNull();
  });

  /**
   * US-077: BigInt Balance Precision Tests
   *
   * JavaScript numbers use IEEE 754 double-precision floats, which only have
   * 53 bits of mantissa. This means values > Number.MAX_SAFE_INTEGER (2^53 - 1)
   * lose precision when converted to Number.
   *
   * The gateway sends balance as string to preserve precision, but parseNumeric()
   * converts to Number, potentially losing precision for very large balances.
   *
   * DOCUMENTED BEHAVIOR: These tests document the current behavior and its limitations.
   * For production use with large crypto balances, consider using BigInt or string storage.
   */
  describe("BigInt balance precision (US-077)", () => {
    it("correctly parses balance at Number.MAX_SAFE_INTEGER boundary", () => {
      // Number.MAX_SAFE_INTEGER = 2^53 - 1 = 9007199254740991
      const maxSafe = Number.MAX_SAFE_INTEGER;
      expect(maxSafe).toBe(9007199254740991);

      // Parsing MAX_SAFE_INTEGER as string should work correctly
      const parsed = parseNumeric("9007199254740991");
      expect(parsed).toBe(9007199254740991);

      // Verify this is exactly MAX_SAFE_INTEGER
      expect(parsed).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("DOCUMENTS: precision loss for balance > MAX_SAFE_INTEGER", () => {
      // MAX_SAFE_INTEGER + 1 = 9007199254740992
      // This value CAN be represented exactly (it's a power of 2 boundary)
      const justAbove = parseNumeric("9007199254740992");
      expect(justAbove).toBe(9007199254740992);

      // MAX_SAFE_INTEGER + 2 = 9007199254740993
      // CRITICAL: This value CANNOT be represented exactly - it rounds to 9007199254740992
      const withPrecisionLoss = parseNumeric("9007199254740993");

      // DOCUMENT THE BUG: The parsed value does NOT equal the string representation
      // This proves parseNumeric loses precision for large values
      expect(withPrecisionLoss?.toString()).not.toBe("9007199254740993");
      expect(withPrecisionLoss?.toString()).toBe("9007199254740992"); // Wrong value!

      // The actual value is 9007199254740992, not 9007199254740993
      // We can verify by comparing with BigInt
      const correctValue = BigInt("9007199254740993");
      const parsedAsBigInt = BigInt(withPrecisionLoss!);
      expect(parsedAsBigInt).not.toBe(correctValue);
      expect(correctValue - parsedAsBigInt).toBe(1n); // Lost 1 unit
    });

    it("DOCUMENTS: precision loss pattern for values beyond MAX_SAFE_INTEGER", () => {
      // Every other integer above MAX_SAFE_INTEGER cannot be represented
      // Pattern: values ending in odd digits after 2^53 lose the last bit

      // 9007199254740994 - representable (even)
      expect(parseNumeric("9007199254740994")).toBe(9007199254740994);

      // 9007199254740995 - NOT representable (rounds to 9007199254740996)
      expect(parseNumeric("9007199254740995")).toBe(9007199254740996);

      // 9007199254740996 - representable (even)
      expect(parseNumeric("9007199254740996")).toBe(9007199254740996);
    });

    it("DOCUMENTS: balance as string preserves original value info", () => {
      // Gateway sends balance like: { balance: "9007199254740993" }
      // The string itself has full precision
      const balanceString = "9007199254740993";

      // String contains the correct value
      expect(balanceString).toBe("9007199254740993");

      // But parseNumeric loses precision
      const parsed = parseNumeric(balanceString);
      expect(parsed?.toString()).not.toBe("9007199254740993");
      expect(parsed?.toString()).toBe("9007199254740992");
    });

    it("verifies UI display would show incorrect balance for large values", () => {
      // Simulate a user with a very large balance (e.g., from crypto winnings)
      const actualBalance = "10000000000000001"; // 10 quadrillion + 1

      // Parse as mobile app would
      const displayedBalance = parseNumeric(actualBalance);

      // The displayed balance loses the +1
      expect(displayedBalance).toBe(10000000000000000);
      expect(displayedBalance?.toString()).not.toBe(actualBalance);

      // Format for display - user sees wrong balance
      const formattedDisplay = displayedBalance?.toLocaleString();
      expect(formattedDisplay).toBe("10,000,000,000,000,000");
      // But actual balance is "10,000,000,000,000,001" - off by 1!
    });

    it("DOCUMENTS: BigInt would preserve precision correctly", () => {
      // This documents the recommended fix approach
      const balanceString = "9007199254740993";

      // BigInt preserves full precision
      const asBigInt = BigInt(balanceString);
      expect(asBigInt.toString()).toBe("9007199254740993");

      // For display, convert BigInt to string, never to Number
      expect(asBigInt.toString()).not.toBe(
        Number(balanceString).toString()
      );
    });

    it("DOCUMENTS: zero balance is handled correctly", () => {
      expect(parseNumeric("0")).toBe(0);
      expect(parseNumeric(0)).toBe(0);
      expect(parseNumeric("0.0")).toBe(0);
    });

    it("DOCUMENTS: decimal balance is handled correctly", () => {
      // If balances had decimals (e.g., from fractional tokens)
      expect(parseNumeric("123.456")).toBe(123.456);
      expect(parseNumeric("0.00001")).toBe(0.00001);
    });

    it("DOCUMENTS: negative balance display (edge case)", () => {
      // Negative balances shouldn't occur, but parseNumeric handles them
      expect(parseNumeric("-100")).toBe(-100);
      expect(parseNumeric("-9007199254740991")).toBe(-9007199254740991);
    });

    it("validates Number.isSafeInteger for balance validation", () => {
      // Helper pattern for checking if balance can be safely represented
      const isSafe = (value: number) => Number.isSafeInteger(value);

      expect(isSafe(9007199254740991)).toBe(true); // MAX_SAFE_INTEGER
      expect(isSafe(9007199254740992)).toBe(false); // Just above
      expect(isSafe(10000000000000000)).toBe(false); // Large round number

      // For UI, could add warning when balance exceeds MAX_SAFE_INTEGER
      const balance = parseNumeric("10000000000000001");
      if (balance && !Number.isSafeInteger(balance)) {
        // Would display: "Balance may be approximate for very large values"
        expect(true).toBe(true); // Just documenting the pattern
      }
    });

    it("DOCUMENTS: MAX_SAFE_INTEGER value for reference", () => {
      // Document the exact boundary for developers
      expect(Number.MAX_SAFE_INTEGER).toBe(9007199254740991);
      expect(Number.MAX_SAFE_INTEGER).toBe(2 ** 53 - 1);

      // Practical interpretation: ~9 quadrillion units
      // For a token with 9 decimals, this is ~9 billion whole tokens
      // For most games, this limit won't be hit
      // But for high-stakes or accumulated jackpots, it could matter
    });
  });
});
