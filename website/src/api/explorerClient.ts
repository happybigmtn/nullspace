export interface ExplorerBlock {
  height: number;
  view: number;
  block_digest: string;
  parent?: string | null;
  tx_hashes: string[];
  tx_count: number;
  indexed_at_ms: number;
}

export interface ExplorerTransaction {
  hash: string;
  block_height: number;
  block_digest: string;
  position: number;
  public_key: string;
  nonce: number;
  description?: string | null;
  instruction: string;
}

export interface AccountActivity {
  public_key: string;
  txs: string[];
  events: string[];
  last_nonce?: number | null;
  last_updated_height?: number | null;
}

interface BlocksResponse {
  blocks: ExplorerBlock[];
  next_offset?: number | null;
  total: number;
}

type SearchResponse =
  | { type: 'block'; block: ExplorerBlock }
  | { type: 'transaction'; transaction: ExplorerTransaction }
  | { type: 'account'; account: AccountActivity };

const API_BASE = '/api';
const FETCH_TIMEOUT_MS = 10000;

class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'FetchTimeoutError';
  }
}

export class ResponseValidationError extends Error {
  constructor(endpoint: string, reason: string) {
    super(`Invalid response from ${endpoint}: ${reason}`);
    this.name = 'ResponseValidationError';
  }
}

function isExplorerBlock(data: unknown): data is ExplorerBlock {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.height === 'number' &&
    typeof obj.view === 'number' &&
    typeof obj.block_digest === 'string' &&
    Array.isArray(obj.tx_hashes) &&
    typeof obj.tx_count === 'number' &&
    typeof obj.indexed_at_ms === 'number'
  );
}

function isExplorerTransaction(data: unknown): data is ExplorerTransaction {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.hash === 'string' &&
    typeof obj.block_height === 'number' &&
    typeof obj.block_digest === 'string' &&
    typeof obj.position === 'number' &&
    typeof obj.public_key === 'string' &&
    typeof obj.nonce === 'number' &&
    typeof obj.instruction === 'string'
  );
}

function isAccountActivity(data: unknown): data is AccountActivity {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.public_key === 'string' &&
    Array.isArray(obj.txs) &&
    Array.isArray(obj.events)
  );
}

function isBlocksResponse(data: unknown): data is BlocksResponse {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    Array.isArray(obj.blocks) &&
    obj.blocks.every(isExplorerBlock) &&
    typeof obj.total === 'number'
  );
}

function isSearchResponse(data: unknown): data is SearchResponse {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (obj.type === 'block') return isExplorerBlock(obj.block);
  if (obj.type === 'transaction') return isExplorerTransaction(obj.transaction);
  if (obj.type === 'account') return isAccountActivity(obj.account);
  return false;
}

async function getJson<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }

    try {
      return await res.json();
    } catch (parseError) {
      console.error('Failed to parse JSON response:', parseError);
      throw new Error('Server returned invalid JSON response');
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new FetchTimeoutError(url, FETCH_TIMEOUT_MS);
    }
    throw error;
  }
}

export async function fetchBlocks(offset = 0, limit = 20): Promise<BlocksResponse> {
  const endpoint = `/explorer/blocks?offset=${offset}&limit=${limit}`;
  const data = await getJson<unknown>(endpoint);
  if (!isBlocksResponse(data)) {
    console.error('Invalid blocks response:', data);
    throw new ResponseValidationError(endpoint, 'missing or invalid blocks/total fields');
  }
  return data;
}

export async function fetchBlock(id: string | number): Promise<ExplorerBlock> {
  const endpoint = `/explorer/blocks/${id}`;
  const data = await getJson<unknown>(endpoint);
  if (!isExplorerBlock(data)) {
    console.error('Invalid block response:', data);
    throw new ResponseValidationError(endpoint, 'missing required block fields');
  }
  return data;
}

export async function fetchTransaction(hash: string): Promise<ExplorerTransaction> {
  const endpoint = `/explorer/tx/${hash}`;
  const data = await getJson<unknown>(endpoint);
  if (!isExplorerTransaction(data)) {
    console.error('Invalid transaction response:', data);
    throw new ResponseValidationError(endpoint, 'missing required transaction fields');
  }
  return data;
}

export async function fetchAccount(pubkey: string): Promise<AccountActivity> {
  const endpoint = `/explorer/account/${pubkey}`;
  const data = await getJson<unknown>(endpoint);
  if (!isAccountActivity(data)) {
    console.error('Invalid account response:', data);
    throw new ResponseValidationError(endpoint, 'missing required account fields');
  }
  return data;
}

export async function searchExplorer(query: string): Promise<SearchResponse> {
  const endpoint = `/explorer/search?q=${encodeURIComponent(query)}`;
  const data = await getJson<unknown>(endpoint);
  if (!isSearchResponse(data)) {
    console.error('Invalid search response:', data);
    throw new ResponseValidationError(endpoint, 'invalid search result type or missing fields');
  }
  return data;
}
