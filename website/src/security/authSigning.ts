import { initWasm } from "../api/wasm.js";
import { getUnlockedVault } from "./vaultRuntime";

// Keep in sync with services/auth/src/server.ts.
const AUTH_CHALLENGE_PREFIX = "nullspace-auth:";

const hexToBytes = (hex: string): Uint8Array => {
  const normalized = hex.trim().replace(/^0x/i, "");
  if (!normalized || normalized.length % 2 !== 0) {
    throw new Error("invalid-hex");
  }
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

const buildAuthMessage = (challengeHex: string): Uint8Array => {
  const prefix = new TextEncoder().encode(AUTH_CHALLENGE_PREFIX);
  const challenge = hexToBytes(challengeHex);
  const message = new Uint8Array(prefix.length + challenge.length);
  message.set(prefix, 0);
  message.set(challenge, prefix.length);
  return message;
};

export async function signAuthChallenge(challengeHex: string): Promise<string> {
  const vault = getUnlockedVault();
  if (!vault) {
    throw new Error("vault-locked");
  }
  const wasm = await initWasm();
  const signer = wasm.Signer.from_bytes(vault.nullspaceEd25519PrivateKey);
  const message = buildAuthMessage(challengeHex);
  const signature = signer.sign(message);
  if (typeof signer.free === "function") {
    signer.free();
  }
  return bytesToHex(signature);
}
