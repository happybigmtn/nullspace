const authBase =
  (import.meta.env.VITE_AUTH_URL as string | undefined)?.replace(/\/$/, "") ??
  "";

export type AuthSessionUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  authProvider?: string;
  authSubject?: string;
};

export type AuthSession = {
  user?: AuthSessionUser;
  expires?: string;
};

export type Entitlement = {
  tier: string;
  status: string;
  source: string;
  startsAtMs: number;
  endsAtMs?: number;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  stripeProductId?: string;
};

export type EvmLink = {
  evmAddress: string;
  chainId: number;
  status: string;
  signatureType: string;
  linkedAtMs: number;
  lastVerifiedAtMs: number;
  unlinkedAtMs?: number;
};

export type AuthProfile = {
  session: AuthSession | null;
  entitlements: Entitlement[];
  evmLink?: EvmLink | null;
};

export type AuthChallenge = {
  challengeId: string;
  challenge: string;
  expiresAtMs: number;
};

export type EvmChallenge = {
  challengeId: string;
  message: string;
  expiresAtMs: number;
  address: string;
  chainId: number;
};

const authPath = (path: string) => `${authBase}${path}`;

const authFetch = (path: string, init?: RequestInit) => {
  return fetch(authPath(path), {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
};

const readError = async (res: Response) => {
  try {
    const data = await res.json();
    if (data?.error) return String(data.error);
  } catch {
    // ignore parse errors
  }
  return `Request failed (${res.status})`;
};

const readAuthTextError = async (res: Response) => {
  try {
    const text = await res.text();
    if (text) return text.slice(0, 200);
  } catch {
    // ignore
  }
  return `Request failed (${res.status})`;
};

export const authLinks = {
  signIn: (callbackUrl?: string) => {
    if (!authBase) {
      return callbackUrl ? `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/auth/signin";
    }
    const url = new URL(`${authBase}/auth/signin`);
    if (callbackUrl) url.searchParams.set("callbackUrl", callbackUrl);
    return url.toString();
  },
  signOut: (callbackUrl?: string) => {
    if (!authBase) {
      return callbackUrl ? `/auth/signout?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/auth/signout";
    }
    const url = new URL(`${authBase}/auth/signout`);
    if (callbackUrl) url.searchParams.set("callbackUrl", callbackUrl);
    return url.toString();
  },
};

export async function getProfile(): Promise<AuthProfile> {
  const res = await authFetch("/profile", { method: "GET" });
  if (res.status === 401) {
    return { session: null, entitlements: [] };
  }
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as AuthProfile;
}

export async function linkPublicKey(input: {
  publicKey: string;
  signature: string;
  challengeId: string;
}): Promise<void> {
  const res = await authFetch("/profile/link-public-key", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
}

export async function requestEvmChallenge(input: {
  address: string;
  chainId: number;
}): Promise<EvmChallenge> {
  const res = await authFetch("/profile/evm-challenge", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as EvmChallenge;
}

export async function linkEvmAddress(input: {
  address: string;
  chainId: number;
  signature: string;
  challengeId: string;
}): Promise<EvmLink> {
  const res = await authFetch("/profile/link-evm", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const data = (await res.json()) as { link: EvmLink };
  return data.link;
}

export async function unlinkEvmAddress(): Promise<void> {
  const res = await authFetch("/profile/unlink-evm", { method: "POST" });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
}

export async function createCheckoutSession(input: {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  tier?: string;
  allowPromotionCodes?: boolean;
}): Promise<{ url: string }> {
  const res = await authFetch("/billing/checkout", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as { url: string };
}

export async function createBillingPortalSession(input: {
  returnUrl: string;
}): Promise<{ url: string }> {
  const res = await authFetch("/billing/portal", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as { url: string };
}

export async function syncFreerollLimit(): Promise<{ status?: string; limit?: number }> {
  const res = await authFetch("/profile/sync-freeroll", { method: "POST" });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as { status?: string; limit?: number };
}

export async function getCsrfToken(): Promise<string> {
  const res = await authFetch("/auth/csrf", { method: "GET" });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const data = (await res.json()) as { csrfToken?: string };
  if (!data?.csrfToken) {
    throw new Error("Missing csrf token");
  }
  return data.csrfToken;
}

export async function requestAuthChallenge(publicKey: string): Promise<AuthChallenge> {
  const res = await authFetch("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ publicKey }),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as AuthChallenge;
}

export async function signInWithKey(input: {
  publicKey: string;
  signature: string;
  challengeId: string;
  callbackUrl?: string;
}): Promise<void> {
  const csrfToken = await getCsrfToken();
  const callbackUrl =
    input.callbackUrl ?? (typeof window !== "undefined" ? window.location.href : "/");
  const body = new URLSearchParams({
    csrfToken,
    publicKey: input.publicKey,
    signature: input.signature,
    challengeId: input.challengeId,
    callbackUrl,
  });

  const res = await fetch(authPath("/auth/callback/credentials"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "manual",
  });

  if (res.type === "opaqueredirect") {
    return;
  }
  if (res.status === 302 || res.ok) {
    return;
  }
  throw new Error(await readAuthTextError(res));
}
