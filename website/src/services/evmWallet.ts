export type EvmWalletInfo = {
  address: string;
  chainId: number;
};

const getProvider = (): any => {
  if (typeof window === 'undefined') return null;
  return (window as any).ethereum ?? null;
};

export const hasEvmProvider = (): boolean => Boolean(getProvider());

const hexToNumber = (hex: string): number => {
  if (!hex) return 0;
  return Number.parseInt(hex, 16);
};

export async function connectEvmWallet(): Promise<EvmWalletInfo> {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No EVM wallet detected');
  }
  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[];
  const address = accounts?.[0];
  if (!address) {
    throw new Error('No EVM account available');
  }
  const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string;
  const chainId = hexToNumber(chainIdHex);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error('Invalid chainId');
  }
  return { address, chainId };
}

export async function signEvmMessage(address: string, message: string): Promise<string> {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No EVM wallet detected');
  }
  const signature = (await provider.request({
    method: 'personal_sign',
    params: [message, address],
  })) as string;
  if (!signature) {
    throw new Error('Signature request failed');
  }
  return signature;
}
