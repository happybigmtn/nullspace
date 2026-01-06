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

const API_BASE = '/api';
const FETCH_TIMEOUT_MS = 10000;

class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'FetchTimeoutError';
  }
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

export async function fetchBlocks(offset = 0, limit = 20): Promise<{
  blocks: ExplorerBlock[];
  next_offset?: number | null;
  total: number;
}> {
  return getJson(`/explorer/blocks?offset=${offset}&limit=${limit}`);
}

export async function fetchBlock(id: string | number): Promise<ExplorerBlock> {
  return getJson(`/explorer/blocks/${id}`);
}

export async function fetchTransaction(hash: string): Promise<ExplorerTransaction> {
  return getJson(`/explorer/tx/${hash}`);
}

export async function fetchAccount(pubkey: string): Promise<AccountActivity> {
  return getJson(`/explorer/account/${pubkey}`);
}

export async function searchExplorer(
  query: string
): Promise<
  | { type: 'block'; block: ExplorerBlock }
  | { type: 'transaction'; transaction: ExplorerTransaction }
  | { type: 'account'; account: AccountActivity }
> {
  return getJson(`/explorer/search?q=${encodeURIComponent(query)}`);
}
