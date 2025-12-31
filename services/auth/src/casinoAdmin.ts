import { ConvexHttpClient } from "convex/browser";
import { createRequire } from "module";
import { pathToFileURL } from "url";

// Avoid pulling Convex source files into the auth build output.
const require = createRequire(import.meta.url);
const { api } = require("website/convex/_generated/api.js") as { api: any };

type Entitlement = {
  tier?: string;
  status?: string;
  source?: string;
};

type WasmModule = {
  default: (input?: { module_or_path?: ArrayBuffer | Uint8Array }) => Promise<void>;
  Signer: {
    from_bytes: (bytes: Uint8Array) => any;
  };
  Transaction: {
    casino_set_tournament_limit: (
      signer: any,
      nonce: bigint,
      playerPublicKey: Uint8Array,
      dailyLimit: number,
    ) => { encode: () => Uint8Array };
  };
  encode_account_key: (publicKey: Uint8Array) => Uint8Array;
  encode_casino_player_key: (publicKey: Uint8Array) => Uint8Array;
  hash_key: (key: Uint8Array) => Uint8Array;
  decode_lookup: (lookup: Uint8Array, identity: Uint8Array) => any;
  wrap_transaction_submission: (tx: Uint8Array) => Uint8Array;
};

type AdminState = {
  wasm: WasmModule;
  signer: any;
  adminPublicKeyBytes: Uint8Array;
  identityBytes: Uint8Array;
  baseUrl: string;
  nextNonce?: number;
};

type NonceStore = {
  client: ConvexHttpClient;
  serviceToken: string;
  adminPublicKeyHex: string;
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

const normalizeHex = (value: string): string =>
  value.trim().toLowerCase().replace(/^0x/, "");

const readSecretFile = async (filePath: string, label: string): Promise<string | null> => {
  try {
    const fs = await import("fs/promises");
    const contents = await fs.readFile(filePath, "utf8");
    const trimmed = contents.trim();
    if (!trimmed) {
      console.warn(`[auth] ${label} file is empty: ${filePath}`);
      return null;
    }
    return trimmed;
  } catch (error) {
    console.warn(`[auth] Failed to read ${label} file: ${filePath}`, error);
    return null;
  }
};

const extractSecretValue = (payload: string): string | null => {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, any>;
      const candidates = [
        parsed.CASINO_ADMIN_PRIVATE_KEY_HEX,
        parsed.adminKeyHex,
        parsed.admin_key_hex,
        parsed.key,
        parsed.value,
        parsed.secret,
        parsed?.data?.key,
        parsed?.data?.value,
        parsed?.data?.secret,
        parsed?.data?.data?.key,
        parsed?.data?.data?.value,
        parsed?.data?.data?.secret,
      ];
      const found = candidates.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
      return found ? String(found).trim() : null;
    } catch {
      return null;
    }
  }
  return trimmed;
};

const readSecretUrl = async (url: string, label: string): Promise<string | null> => {
  try {
    const headers: Record<string, string> = {};
    const bearer = process.env.CASINO_ADMIN_PRIVATE_KEY_TOKEN;
    if (bearer) {
      headers.Authorization = `Bearer ${bearer}`;
    }
    const vaultToken = process.env.VAULT_TOKEN;
    if (vaultToken) {
      headers["X-Vault-Token"] = vaultToken;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.warn(`[auth] Failed to fetch ${label} from URL (${response.status})`);
      return null;
    }
    const body = await response.text();
    const extracted = extractSecretValue(body);
    if (!extracted) {
      console.warn(`[auth] ${label} URL response did not contain a usable secret`);
    }
    return extracted;
  } catch (error) {
    console.warn(`[auth] Failed to fetch ${label} from URL: ${url}`, error);
    return null;
  }
};

const resolveAdminKeyHex = async (): Promise<string> => {
  const secretUrl = process.env.CASINO_ADMIN_PRIVATE_KEY_URL;
  if (secretUrl) {
    const fromUrl = await readSecretUrl(secretUrl, "admin key");
    if (fromUrl) return fromUrl;
  }

  const filePath = process.env.CASINO_ADMIN_PRIVATE_KEY_FILE;
  if (filePath) {
    const fromFile = await readSecretFile(filePath, "admin key");
    if (fromFile) return fromFile;
  }

  const fromEnv = process.env.CASINO_ADMIN_PRIVATE_KEY_HEX ?? "";
  const allowEnv =
    process.env.ALLOW_INSECURE_ADMIN_KEY_ENV === "true" || process.env.NODE_ENV !== "production";
  if (fromEnv && allowEnv) {
    return fromEnv;
  }
  if (fromEnv && !allowEnv) {
    console.warn(
      "[auth] CASINO_ADMIN_PRIVATE_KEY_HEX is not allowed in production; use CASINO_ADMIN_PRIVATE_KEY_FILE instead.",
    );
  }
  return "";
};

const parseLimit = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(255, Math.floor(parsed));
};

const getMemberTiers = (): string[] => {
  const raw = process.env.FREEROLL_MEMBER_TIERS ?? "";
  return raw
    .split(",")
    .map((tier) => tier.trim())
    .filter(Boolean);
};

const hasActiveEntitlement = (entitlements: Entitlement[], tiers: string[]): boolean => {
  return entitlements.some((entitlement) => {
    if (!ACTIVE_STATUSES.has(entitlement.status ?? "")) return false;
    if (tiers.length === 0) return true;
    return tiers.includes(entitlement.tier ?? "");
  });
};

const hexToBytes = (hex: string): Uint8Array => {
  const normalized = normalizeHex(hex);
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

let wasmPromise: Promise<WasmModule | null> | null = null;
let adminQueue: Promise<unknown> = Promise.resolve();
let nonceStorePromise: Promise<NonceStore | null> | null = null;

const loadWasm = async (): Promise<WasmModule | null> => {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const wasmModulePath = require.resolve("website/wasm/pkg/nullspace_wasm.js");
      const wasmBinPath = require.resolve("website/wasm/pkg/nullspace_wasm_bg.wasm");
      const wasmModule = (await import(pathToFileURL(wasmModulePath).href)) as WasmModule;
      const fs = await import("fs/promises");
      const wasmBytes = await fs.readFile(wasmBinPath);
      await wasmModule.default({ module_or_path: wasmBytes });
      return wasmModule;
    })().catch((error) => {
      console.warn("[auth] Failed to load wasm module:", error);
      return null;
    });
  }
  return wasmPromise;
};

const initAdminState = async (adminKeyHex: string): Promise<AdminState | null> => {
  const normalizedKey = normalizeHex(adminKeyHex);
  const identityHex = normalizeHex(process.env.CASINO_IDENTITY_HEX ?? "");
  const baseUrl = process.env.CASINO_API_URL ?? "http://localhost:8080/api";

  if (!normalizedKey || normalizedKey.length !== 64) {
    console.warn("[auth] Missing or invalid casino admin private key");
    return null;
  }
  if (!identityHex || identityHex.length !== 192) {
    console.warn("[auth] Missing or invalid CASINO_IDENTITY_HEX");
    return null;
  }

  const wasm = await loadWasm();
  if (!wasm) return null;

  const adminKeyBytes = hexToBytes(normalizedKey);
  const signer = wasm.Signer.from_bytes(adminKeyBytes);
  const adminPublicKeyBytes = signer.public_key as Uint8Array;
  const identityBytes = hexToBytes(identityHex);

  return { wasm, signer, adminPublicKeyBytes, identityBytes, baseUrl };
};

const initNonceStore = async (state: AdminState): Promise<NonceStore | null> => {
  const convexUrl = process.env.CONVEX_URL ?? "";
  const serviceToken = process.env.CONVEX_SERVICE_TOKEN ?? "";
  if (!convexUrl || !serviceToken) {
    console.warn("[auth] Missing CONVEX_URL or CONVEX_SERVICE_TOKEN; using local nonce cache.");
    return null;
  }
  const client = new ConvexHttpClient(convexUrl, {
    skipConvexDeploymentUrlCheck: true,
  });
  return {
    client,
    serviceToken,
    adminPublicKeyHex: bytesToHex(state.adminPublicKeyBytes),
  };
};

let adminStatePromise: Promise<AdminState | null> | null = null;
let adminStateKeyHex: string | null = null;

const getAdminState = async (): Promise<AdminState | null> => {
  const resolvedKeyHex = normalizeHex(await resolveAdminKeyHex());
  if (adminStatePromise && adminStateKeyHex === resolvedKeyHex) {
    return adminStatePromise;
  }
  adminStateKeyHex = resolvedKeyHex;
  nonceStorePromise = null;
  adminStatePromise = initAdminState(resolvedKeyHex).catch((error) => {
    console.warn("[auth] Failed to init admin state:", error);
    return null;
  });
  return adminStatePromise;
};

const getNonceStore = async (state: AdminState): Promise<NonceStore | null> => {
  if (!nonceStorePromise) {
    nonceStorePromise = initNonceStore(state).catch((error) => {
      console.warn("[auth] Failed to init nonce store:", error);
      return null;
    });
  }
  return nonceStorePromise;
};

const enqueueAdmin = async <T>(task: () => Promise<T>): Promise<T> => {
  const next = adminQueue.then(task, task);
  adminQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};

const queryState = async (
  state: AdminState,
  keyBytes: Uint8Array,
): Promise<any | null> => {
  const hashed = state.wasm.hash_key(keyBytes);
  const hexKey = bytesToHex(hashed);
  const response = await fetch(`${state.baseUrl}/state/${hexKey}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`State query failed (${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return null;
  return state.wasm.decode_lookup(bytes, state.identityBytes);
};

const getAccountNonce = async (state: AdminState): Promise<number> => {
  const keyBytes = state.wasm.encode_account_key(state.adminPublicKeyBytes);
  const value = await queryState(state, keyBytes);
  if (!value || value.type !== "Account") return 0;
  return Number(value.nonce ?? 0);
};

const reserveNonce = async (state: AdminState): Promise<number> => {
  const store = await getNonceStore(state);
  if (store) {
    const fallbackNonce = await getAccountNonce(state);
    try {
      return await store.client.mutation(api.admin.reserveAdminNonce, {
        serviceToken: store.serviceToken,
        adminPublicKey: store.adminPublicKeyHex,
        fallbackNonce,
      });
    } catch (error) {
      console.warn("[auth] Nonce store reservation failed, falling back:", error);
    }
  }

  if (state.nextNonce === undefined) {
    state.nextNonce = await getAccountNonce(state);
  }
  const nonce = state.nextNonce;
  state.nextNonce += 1;
  return nonce;
};

const resetNonceStore = async (state: AdminState): Promise<void> => {
  state.nextNonce = undefined;
  const store = await getNonceStore(state);
  if (!store) return;
  const chainNonce = await getAccountNonce(state);
  await store.client.mutation(api.admin.resetAdminNonce, {
    serviceToken: store.serviceToken,
    adminPublicKey: store.adminPublicKeyHex,
    nextNonce: chainNonce,
  });
};

const getPlayer = async (state: AdminState, publicKeyBytes: Uint8Array): Promise<any | null> => {
  const keyBytes = state.wasm.encode_casino_player_key(publicKeyBytes);
  const value = await queryState(state, keyBytes);
  if (!value || value.type !== "CasinoPlayer") return null;
  return value;
};

const submitTransaction = async (state: AdminState, tx: Uint8Array): Promise<void> => {
  const submission = state.wasm.wrap_transaction_submission(tx);
  const response = await fetch(`${state.baseUrl}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: Buffer.from(submission),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Submit failed (${response.status}): ${text}`);
  }
};

export const syncFreerollLimit = async (
  publicKeyHex: string,
  entitlements: Entitlement[],
): Promise<{ status: string; limit?: number }> => {
  const state = await getAdminState();
  if (!state) {
    return { status: "admin_unconfigured" };
  }

  const normalizedKey = normalizeHex(publicKeyHex);
  if (normalizedKey.length !== 64) {
    return { status: "invalid_public_key" };
  }

  const freeLimit = parseLimit(process.env.FREEROLL_DAILY_LIMIT_FREE, 1);
  const memberLimit = parseLimit(process.env.FREEROLL_DAILY_LIMIT_MEMBER, 10);
  const tiers = getMemberTiers();
  const desiredLimit = hasActiveEntitlement(entitlements, tiers)
    ? memberLimit
    : freeLimit;

  return enqueueAdmin(async () => {
    const playerKeyBytes = hexToBytes(normalizedKey);
    const player = await getPlayer(state, playerKeyBytes);
    if (!player) {
      return { status: "player_not_found" };
    }

    const currentLimit = Number(player.tournament_daily_limit ?? 0);
    const adminPublicKeyHex = bytesToHex(state.adminPublicKeyBytes);
    if (currentLimit === desiredLimit) {
      console.info("[auth][audit] tournament_limit.no_change", {
        playerPublicKey: normalizedKey,
        currentLimit,
        desiredLimit,
        adminPublicKey: adminPublicKeyHex,
      });
      return { status: "already_set", limit: desiredLimit };
    }

    try {
      const nonce = await reserveNonce(state);
      const tx = state.wasm.Transaction.casino_set_tournament_limit(
        state.signer,
        BigInt(nonce),
        playerKeyBytes,
        desiredLimit,
      );
      console.info("[auth][audit] tournament_limit.submit", {
        playerPublicKey: normalizedKey,
        currentLimit,
        desiredLimit,
        adminPublicKey: adminPublicKeyHex,
      });
      await submitTransaction(state, tx.encode());
      console.info("[auth][audit] tournament_limit.submitted", {
        playerPublicKey: normalizedKey,
        desiredLimit,
        adminPublicKey: adminPublicKeyHex,
      });
      return { status: "submitted", limit: desiredLimit };
    } catch (error) {
      console.warn("[auth][audit] tournament_limit.failed", {
        playerPublicKey: normalizedKey,
        desiredLimit,
        adminPublicKey: adminPublicKeyHex,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await resetNonceStore(state);
      } catch (resetError) {
        console.warn("[auth] Failed to reset nonce store:", resetError);
      }
      throw error;
    }
  });
};
