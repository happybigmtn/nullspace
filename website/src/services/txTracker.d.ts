export type ActivitySurface = 'casino' | 'economy' | 'staking' | 'bridge' | 'security' | 'system';
export type ActivityLevel = 'info' | 'success' | 'error';

export type TxStatus = 'submitted' | 'confirmed' | 'failed';
export type TxKind =
  | 'register'
  | 'deposit'
  | 'bridge_withdraw'
  | 'bridge_deposit'
  | 'bridge_finalize'
  | 'oracle_update'
  | 'swap'
  | 'add_liquidity'
  | 'remove_liquidity'
  | 'create_vault'
  | 'deposit_collateral'
  | 'borrow'
  | 'repay'
  | 'savings_deposit'
  | 'savings_withdraw'
  | 'savings_claim'
  | 'stake'
  | 'unstake'
  | 'claim_rewards'
  | 'process_epoch'
  | 'casino_start'
  | 'casino_move';

export type ActivityLogItem = {
  id: string;
  type: 'log';
  ts: number;
  surface: ActivitySurface;
  level: ActivityLevel;
  message: string;
};

export type ActivityTxItem = {
  id: string;
  type: 'tx';
  ts: number;
  surface: ActivitySurface;
  kind: TxKind;
  status: TxStatus;
  message: string;
  finalMessage?: string;
  updatedTs: number;
  pubkeyHex?: string;
  nonce?: number;
  txHash?: string;
  txDigest?: string;
  error?: string;
};

export type ActivityItem = ActivityLogItem | ActivityTxItem;

export const STORAGE_KEY: string;
export const MAX_ITEMS: number;

export function subscribeActivity(listener: () => void): () => void;
export function getActivityItems(surface?: ActivitySurface): ActivityItem[];
export function clearActivity(surface?: ActivitySurface): void;
export function logActivity(surface: ActivitySurface, message: string, level?: ActivityLevel): string;
export function trackTxSubmitted(args: {
  surface: ActivitySurface;
  kind: TxKind;
  message: string;
  pubkeyHex?: string;
  nonce?: number;
  txHash?: string;
  txDigest?: string;
}): string;
export function trackTxConfirmed(args: {
  surface: ActivitySurface;
  kind: TxKind;
  finalMessage: string;
  pubkeyHex?: string;
  txHash?: string;
  txDigest?: string;
}): string;
export function trackTxFailed(args: {
  surface: ActivitySurface;
  finalMessage: string;
  pubkeyHex?: string;
  kind?: TxKind;
  error?: string;
}): string;

export function exportActivityJson(pretty?: boolean, surface?: ActivitySurface): string;
