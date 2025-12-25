export type StripeTier = {
  tier: string;
  priceId: string;
  label: string;
};

const parseTierEntry = (entry: string): StripeTier | null => {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const [tierRaw, priceRaw] = trimmed.split(":").map((part) => part.trim());
  if (!tierRaw || !priceRaw) return null;
  return {
    tier: tierRaw,
    priceId: priceRaw,
    label: tierRaw.replace(/[_-]+/g, " ").toUpperCase(),
  };
};

export const getStripeTiers = (): StripeTier[] => {
  const raw = import.meta.env.VITE_STRIPE_TIERS as string | undefined;
  if (raw) {
    const tiers = raw
      .split(",")
      .map(parseTierEntry)
      .filter((entry): entry is StripeTier => entry !== null);
    if (tiers.length > 0) return tiers;
  }

  const fallbackPrice = import.meta.env.VITE_STRIPE_PRICE_ID as string | undefined;
  if (!fallbackPrice) return [];
  const fallbackTier = (import.meta.env.VITE_STRIPE_TIER as string | undefined) ?? "starter";
  return [
    {
      tier: fallbackTier,
      priceId: fallbackPrice,
      label: fallbackTier.replace(/[_-]+/g, " ").toUpperCase(),
    },
  ];
};
