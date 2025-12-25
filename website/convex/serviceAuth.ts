const normalizeToken = (value?: string): string => (value ?? "").trim();

export const requireServiceToken = (token?: string): void => {
  const expected = normalizeToken(process.env.CONVEX_SERVICE_TOKEN);
  if (!expected) {
    throw new Error("Missing CONVEX_SERVICE_TOKEN");
  }
  if (normalizeToken(token) !== expected) {
    throw new Error("Unauthorized");
  }
};
