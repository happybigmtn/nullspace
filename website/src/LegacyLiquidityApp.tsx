import React, { useEffect, useMemo, useRef, useState } from 'react';
import { WasmWrapper } from './api/wasm.js';
import { CasinoClient } from './api/client.js';
import { PlaySwapStakeTabs } from './components/PlaySwapStakeTabs';
import { AuthStatusPill } from './components/AuthStatusPill';

type ActivityItem = { ts: number; message: string };

function parseAmount(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return 0n;
  try {
    const n = BigInt(trimmed);
    if (n < 0n) return null;
    return n;
  } catch {
    return null;
  }
}

function estimateSwapOut(amm: any, amountIn: bigint, isBuyingRng: boolean): { out: bigint; fee: bigint; burned: bigint } {
  if (!amm) return { out: 0n, fee: 0n, burned: 0n };
  const reserveRng = BigInt(amm.reserveRng ?? 0);
  const reserveVusdt = BigInt(amm.reserveVusdt ?? 0);
  const feeBps = BigInt(amm.feeBasisPoints ?? 0);
  const sellTaxBps = BigInt(amm.sellTaxBasisPoints ?? 0);

  if (amountIn <= 0n || reserveRng <= 0n || reserveVusdt <= 0n) return { out: 0n, fee: 0n, burned: 0n };

  let burned = 0n;
  let effectiveIn = amountIn;
  let reserveIn = reserveVusdt;
  let reserveOut = reserveRng;

  if (!isBuyingRng) {
    reserveIn = reserveRng;
    reserveOut = reserveVusdt;
    burned = (amountIn * sellTaxBps) / 10000n;
    effectiveIn = amountIn - burned;
  }

  const fee = (effectiveIn * feeBps) / 10000n;
  const netIn = effectiveIn - fee;
  const denom = reserveIn + netIn;
  if (denom <= 0n) return { out: 0n, fee, burned };
  const out = (netIn * reserveOut) / denom;
  return { out, fee, burned };
}

export default function LegacyLiquidityApp() {
  const [status, setStatus] = useState<string>('Initializing…');
  const [lastTxSig, setLastTxSig] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const clientRef = useRef<CasinoClient | null>(null);
  const publicKeyBytesRef = useRef<Uint8Array | null>(null);
  const publicKeyHexRef = useRef<string | null>(null);
  const pollRef = useRef<(() => void) | null>(null);
  const lastPollAtRef = useRef(0);

  const [isRegistered, setIsRegistered] = useState(false);
  const [player, setPlayer] = useState<any | null>(null);
  const [vault, setVault] = useState<any | null>(null);
  const [amm, setAmm] = useState<any | null>(null);
  const [lpBalance, setLpBalance] = useState<any | null>(null);
  const [house, setHouse] = useState<any | null>(null);
  const POLL_TICK_MS = 5000;
  const POLL_VISIBLE_MS = 15000;
  const POLL_HIDDEN_MS = 60000;
  const WS_IDLE_MS = 15000;

  // Forms
  const [registerName, setRegisterName] = useState('Trader');
  const [collateralAmount, setCollateralAmount] = useState('0');
  const [borrowAmount, setBorrowAmount] = useState('0');
  const [repayAmount, setRepayAmount] = useState('0');
  const [swapDirection, setSwapDirection] = useState<'BUY_RNG' | 'SELL_RNG'>('BUY_RNG');
  const [swapAmountIn, setSwapAmountIn] = useState('0');
  const [slippageBps, setSlippageBps] = useState(100); // 1.00%
  const [addLiqRng, setAddLiqRng] = useState('0');
  const [addLiqVusdt, setAddLiqVusdt] = useState('0');
  const [removeLiqShares, setRemoveLiqShares] = useState('0');

  const pushActivity = (message: string) => {
    setActivity(prev => [{ ts: Date.now(), message }, ...prev].slice(0, 12));
  };

  useEffect(() => {
    let destroyed = false;

    const init = async () => {
      try {
        const identityHex = import.meta.env.VITE_IDENTITY as string | undefined;
        if (!identityHex) {
          setStatus('Missing VITE_IDENTITY (see website/README.md).');
          return;
        }

        const wasm = new WasmWrapper(identityHex);
        await wasm.init();

        const client = new CasinoClient('/api', wasm);
        await client.init();

        const keypair = client.getOrCreateKeypair();
        if (!keypair) {
          setStatus('Unlock vault (see Vault tab).');
          pushActivity('Vault locked — unlock to continue');
          return;
        }
        publicKeyBytesRef.current = keypair.publicKey;
        publicKeyHexRef.current = keypair.publicKeyHex;
        clientRef.current = client;

        await client.connectUpdates(keypair.publicKey);

        const account = await client.getAccount(keypair.publicKey);
        await client.initNonceManager(keypair.publicKeyHex, keypair.publicKey, account);

        // Event toasts
        const pkHexLower = keypair.publicKeyHex.toLowerCase();
        const applyPlayerBalances = (balances: any) => {
          if (!balances) return;
          setPlayer(prev => prev ? ({
            ...prev,
            chips: Number(balances.chips ?? prev.chips ?? 0),
            vusdtBalance: Number(balances.vusdtBalance ?? prev.vusdtBalance ?? 0),
            shields: Number(balances.shields ?? prev.shields ?? 0),
            doubles: Number(balances.doubles ?? prev.doubles ?? 0),
            tournamentChips: Number(balances.tournamentChips ?? prev.tournamentChips ?? 0),
            tournamentShields: Number(balances.tournamentShields ?? prev.tournamentShields ?? 0),
            tournamentDoubles: Number(balances.tournamentDoubles ?? prev.tournamentDoubles ?? 0),
            activeTournament: balances.activeTournament ?? prev.activeTournament ?? null,
          }) : prev);
        };
        const applyVault = (next: any) => {
          if (next) setVault(next);
        };
        const applyAmm = (next: any) => {
          if (next) setAmm(next);
        };
        const applyHouse = (next: any) => {
          if (next) setHouse(next);
        };
        const applyLpBalance = (balance: any) => {
          if (balance !== undefined && balance !== null) {
            setLpBalance({ balance });
          }
        };
        client.onEvent('CasinoError', (e: any) => {
          if (e?.player?.toLowerCase?.() !== pkHexLower) return;
          pushActivity(`ERROR: ${e.message ?? 'Unknown error'}`);
        });
        client.onEvent('VaultCreated', (e: any) => {
          if (e?.player?.toLowerCase?.() !== pkHexLower) return;
          pushActivity('Vault created');
          applyVault(e?.vault);
        });
        client.onEvent('CollateralDeposited', (e: any) => {
          if (e?.player?.toLowerCase?.() !== pkHexLower) return;
          pushActivity(`Collateral deposited: ${e.amount}`);
          applyVault(e?.vault);
          applyPlayerBalances(e?.playerBalances);
        });
        client.onEvent('VusdtBorrowed', (e: any) => {
          if (e?.player?.toLowerCase?.() !== pkHexLower) return;
          pushActivity(`Borrowed vUSDT: ${e.amount}`);
          applyVault(e?.vault);
          applyPlayerBalances(e?.playerBalances);
        });
        client.onEvent('VusdtRepaid', (e: any) => {
          if (e?.player?.toLowerCase?.() !== pkHexLower) return;
          pushActivity(`Repaid vUSDT: ${e.amount}`);
          applyVault(e?.vault);
          applyPlayerBalances(e?.playerBalances);
        });
        client.onEvent('AmmSwapped', (e: any) => {
          if (e?.player?.toLowerCase?.() !== pkHexLower) return;
          pushActivity(`Swap executed: out=${e.amountOut}`);
          applyAmm(e?.amm);
          applyHouse(e?.house);
          applyPlayerBalances(e?.playerBalances);
        });
        client.onEvent('LiquidityAdded', (e: any) => {
          if (e?.player?.toLowerCase?.() !== pkHexLower) return;
          pushActivity(`Liquidity added: shares=${e.sharesMinted}`);
          applyAmm(e?.amm);
          applyLpBalance(e?.lpBalance);
          applyPlayerBalances(e?.playerBalances);
        });
        client.onEvent('LiquidityRemoved', (e: any) => {
          if (e?.player?.toLowerCase?.() !== pkHexLower) return;
          pushActivity(`Liquidity removed: shares=${e.sharesBurned}`);
          applyAmm(e?.amm);
          applyLpBalance(e?.lpBalance);
          applyPlayerBalances(e?.playerBalances);
        });

        setStatus('Connected');
        pushActivity('Connected');
      } catch (e) {
        console.error('[LiquidityApp] init failed:', e);
        setStatus('Failed to connect. Check simulator + dev-executor.');
      }
    };

    init();

    return () => {
      destroyed = true;
      const client = clientRef.current;
      try {
        client?.destroy?.();
      } catch {
        // ignore
      }
      clientRef.current = null;
      publicKeyBytesRef.current = null;
      publicKeyHexRef.current = null;
    };
  }, []);

  // Poll state
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const poll = async (force = false) => {
      if (cancelled || inFlight) return;
      const client = clientRef.current as any;
      const pk = publicKeyBytesRef.current;
      if (!client || !pk) return;
      const now = Date.now();
      const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const updatesStatus = client.getUpdatesStatus?.();
      const wsConnected = Boolean(updatesStatus?.connected);
      const wsIdle = !updatesStatus?.lastEventAt || now - updatesStatus.lastEventAt > WS_IDLE_MS;
      if (!force && wsConnected && !wsIdle) return;
      const pollInterval = isHidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
      if (!force && now - lastPollAtRef.current < pollInterval) return;
      lastPollAtRef.current = now;
      inFlight = true;

      try {
        const [p, v, a, lp, h] = await Promise.all([
          client.getCasinoPlayer(pk),
          client.getVault(pk),
          client.getAmmPool(),
          client.getLpBalance(pk),
          client.getHouse(),
        ]);
        setPlayer(p);
        setIsRegistered(!!p);
        setVault(v);
        setAmm(a);
        setLpBalance(lp);
        setHouse(h);
      } catch (e) {
        // Ignore transient errors during startup
      } finally {
        inFlight = false;
      }
    };

    void poll(true);
    pollRef.current = () => {
      void poll(true);
    };
    const interval = setInterval(() => {
      void poll(false);
    }, POLL_TICK_MS);

    return () => {
      cancelled = true;
      pollRef.current = null;
      clearInterval(interval);
    };
  }, []);

  const derived = useMemo(() => {
    const reserveRng = BigInt(amm?.reserveRng ?? 0);
    const reserveVusdt = BigInt(amm?.reserveVusdt ?? 0);
    const totalShares = BigInt(amm?.totalShares ?? 0);
    const price = reserveRng > 0n ? Number(reserveVusdt) / Number(reserveRng) : null;
    const tvlVusdt = reserveVusdt * 2n;
    const lpPrice = totalShares > 0n ? Number(tvlVusdt) / Number(totalShares) : null;

    const collateral = BigInt(vault?.collateralRng ?? 0);
    const debt = BigInt(vault?.debtVusdt ?? 0);
    const priceNum = reserveRng > 0n ? reserveVusdt : 1n;
    const priceDen = reserveRng > 0n ? reserveRng : 1n;
    const collateralValue = priceDen > 0n ? (collateral * priceNum) / priceDen : 0n;
    const ltvBps = collateralValue > 0n ? Number((debt * 10_000n) / collateralValue) : 0;
    const maxDebt = collateralValue / 2n;
    const availableDebt = maxDebt > debt ? maxDebt - debt : 0n;

    return {
      reserveRng,
      reserveVusdt,
      totalShares,
      price,
      tvlVusdt,
      lpPrice,
      collateral,
      debt,
      collateralValue,
      ltvBps,
      availableDebt,
    };
  }, [amm, vault]);

  const ensureRegistered = async () => {
    const client = clientRef.current as any;
    if (!client?.nonceManager) throw new Error('Client not ready');
    if (isRegistered) return;
    const name = registerName.trim() || `Trader_${Date.now().toString(36)}`;
    const result = await client.nonceManager.submitCasinoRegister(name);
    if (result?.txHash) setLastTxSig(result.txHash);
    pushActivity(`Submitted register (${name})`);
  };

  const claimFaucet = async () => {
    const client = clientRef.current as any;
    if (!client?.nonceManager) throw new Error('Client not ready');
    await ensureRegistered();
    const result = await client.nonceManager.submitCasinoDeposit(1000);
    if (result?.txHash) setLastTxSig(result.txHash);
    pushActivity('Submitted faucet claim (1000 RNG)');
  };

  const createVault = async () => {
    const client = clientRef.current as any;
    if (!client?.nonceManager) throw new Error('Client not ready');
    await ensureRegistered();
    const result = await client.nonceManager.submitCreateVault();
    if (result?.txHash) setLastTxSig(result.txHash);
    pushActivity('Submitted create vault');
  };

  const depositCollateral = async () => {
    const client = clientRef.current as any;
    if (!client?.nonceManager) throw new Error('Client not ready');
    await ensureRegistered();
    const amt = parseAmount(collateralAmount);
    if (amt === null) {
      pushActivity('Invalid collateral amount');
      return;
    }
    const result = await client.nonceManager.submitDepositCollateral(amt.toString());
    if (result?.txHash) setLastTxSig(result.txHash);
    pushActivity(`Submitted deposit collateral (${amt})`);
  };

  const borrowVusdt = async () => {
    const client = clientRef.current as any;
    if (!client?.nonceManager) throw new Error('Client not ready');
    await ensureRegistered();
    const amt = parseAmount(borrowAmount);
    if (amt === null) {
      pushActivity('Invalid borrow amount');
      return;
    }
    const result = await client.nonceManager.submitBorrowUsdt(amt.toString());
    if (result?.txHash) setLastTxSig(result.txHash);
    pushActivity(`Submitted borrow (${amt} vUSDT)`);
  };

  const repayVusdt = async () => {
    const client = clientRef.current as any;
    if (!client?.nonceManager) throw new Error('Client not ready');
    await ensureRegistered();
    const amt = parseAmount(repayAmount);
    if (amt === null) {
      pushActivity('Invalid repay amount');
      return;
    }
    const result = await client.nonceManager.submitRepayUsdt(amt.toString());
    if (result?.txHash) setLastTxSig(result.txHash);
    pushActivity(`Submitted repay (${amt} vUSDT)`);
  };

  const submitSwap = async () => {
    const client = clientRef.current as any;
    if (!client?.nonceManager) throw new Error('Client not ready');
    await ensureRegistered();
    const amtIn = parseAmount(swapAmountIn);
    if (amtIn === null) {
      pushActivity('Invalid swap amount');
      return;
    }
    const isBuyingRng = swapDirection === 'BUY_RNG';
    const { out } = estimateSwapOut(amm, amtIn, isBuyingRng);
    const minOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
    const result = await client.nonceManager.submitSwap(amtIn.toString(), minOut.toString(), isBuyingRng);
    if (result?.txHash) setLastTxSig(result.txHash);
    pushActivity(`Submitted swap in=${amtIn} minOut=${minOut}`);
  };

  const addLiquidity = async () => {
    const client = clientRef.current as any;
    if (!client?.nonceManager) throw new Error('Client not ready');
    await ensureRegistered();
    const rngAmt = parseAmount(addLiqRng);
    const vusdtAmt = parseAmount(addLiqVusdt);
    if (rngAmt === null || vusdtAmt === null) {
      pushActivity('Invalid add liquidity amounts');
      return;
    }
    const result = await client.nonceManager.submitAddLiquidity(rngAmt.toString(), vusdtAmt.toString());
    if (result?.txHash) setLastTxSig(result.txHash);
    pushActivity(`Submitted add liquidity (RNG=${rngAmt}, vUSDT=${vusdtAmt})`);
  };

  const removeLiquidity = async () => {
    const client = clientRef.current as any;
    if (!client?.nonceManager) throw new Error('Client not ready');
    await ensureRegistered();
    const shares = parseAmount(removeLiqShares);
    if (shares === null) {
      pushActivity('Invalid share amount');
      return;
    }
    const result = await client.nonceManager.submitRemoveLiquidity(shares.toString());
    if (result?.txHash) setLastTxSig(result.txHash);
    pushActivity(`Submitted remove liquidity (shares=${shares})`);
  };

  return (
    <div className="min-h-screen bg-titanium-900 text-white font-mono p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 pb-3 mb-4">
        <div className="flex items-center gap-3">
          <PlaySwapStakeTabs />
          <div className="text-lg font-bold tracking-widest">Liquidity / AMM</div>
          <div className="text-[10px] text-gray-500 tracking-widest">{status}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <AuthStatusPill publicKeyHex={publicKeyHexRef.current} className="w-full sm:w-auto" />
          {lastTxSig ? (
            <div className="text-[10px] text-gray-500 tracking-widest">LAST TX: {lastTxSig}</div>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Wallet */}
        <section className="border border-gray-800 rounded p-4 bg-gray-900/30">
          <div className="text-xs text-gray-400 tracking-widest mb-3">WALLET</div>
          <div className="space-y-2 text-sm">
            <div>Registered: <span className={isRegistered ? 'text-action-success' : 'text-action-destructive'}>{isRegistered ? 'YES' : 'NO'}</span></div>
            <div>RNG: <span className="text-white">{player?.chips ?? 0}</span></div>
            <div>vUSDT: <span className="text-white">{player?.vusdtBalance ?? 0}</span></div>
            <div className="text-[10px] text-gray-600 break-all">PK: {publicKeyHexRef.current ?? '—'}</div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
                value={registerName}
                onChange={(e) => setRegisterName(e.target.value)}
                placeholder="Name"
              />
              <button
                className="text-xs px-3 py-1 rounded border border-action-success text-action-success hover:bg-action-success/10"
                onClick={ensureRegistered}
              >
                Register
              </button>
            </div>
            <button
              className="w-full text-xs px-3 py-2 rounded border border-action-success bg-action-success/10 text-action-success hover:bg-action-success/20"
              onClick={claimFaucet}
            >
              Daily Faucet (1000 RNG)
            </button>
          </div>
        </section>

        {/* AMM */}
        <section className="border border-gray-800 rounded p-4 bg-gray-900/30">
          <div className="text-xs text-gray-400 tracking-widest mb-3">AMM (RNG/vUSDT)</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="border border-gray-800 rounded p-3 bg-black/30">
              <div className="text-[10px] text-gray-500 tracking-widest">RESERVE RNG</div>
              <div className="text-white mt-1">{amm?.reserveRng ?? 0}</div>
            </div>
            <div className="border border-gray-800 rounded p-3 bg-black/30">
              <div className="text-[10px] text-gray-500 tracking-widest">RESERVE vUSDT</div>
              <div className="text-white mt-1">{amm?.reserveVusdt ?? 0}</div>
            </div>
            <div className="border border-gray-800 rounded p-3 bg-black/30">
              <div className="text-[10px] text-gray-500 tracking-widest">PRICE</div>
              <div className="text-white mt-1">{derived.price === null ? '—' : derived.price.toFixed(6)}</div>
              <div className="text-[10px] text-gray-600">vUSDT per RNG</div>
            </div>
            <div className="border border-gray-800 rounded p-3 bg-black/30">
              <div className="text-[10px] text-gray-500 tracking-widest">TVL</div>
              <div className="text-white mt-1">{derived.tvlVusdt.toString()}</div>
              <div className="text-[10px] text-gray-600">~vUSDT</div>
            </div>
          </div>

          <div className="mt-4 border-t border-gray-800 pt-4 space-y-3">
            <div className="text-[10px] text-gray-500 tracking-widest">SWAP</div>
            <div className="flex items-center gap-2">
              <select
                className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
                value={swapDirection}
                onChange={(e) => setSwapDirection(e.target.value as any)}
              >
                <option value="BUY_RNG">Buy RNG (vUSDT → RNG)</option>
                <option value="SELL_RNG">Sell RNG (RNG → vUSDT)</option>
              </select>
              <select
                className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
                value={slippageBps}
                onChange={(e) => setSlippageBps(parseInt(e.target.value))}
              >
                <option value={50}>0.50% slippage</option>
                <option value={100}>1.00% slippage</option>
                <option value={200}>2.00% slippage</option>
                <option value={500}>5.00% slippage</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
                value={swapAmountIn}
                onChange={(e) => setSwapAmountIn(e.target.value)}
                placeholder="Amount in"
              />
              <button
                className="text-xs px-3 py-1 rounded border border-action-destructive text-action-destructive hover:bg-action-destructive/10"
                onClick={submitSwap}
              >
                Swap
              </button>
            </div>

            {(() => {
              const amtIn = parseAmount(swapAmountIn);
              if (amtIn === null) return <div className="text-[10px] text-action-destructive">Invalid amount</div>;
              const isBuyingRng = swapDirection === 'BUY_RNG';
              const { out, fee, burned } = estimateSwapOut(amm, amtIn, isBuyingRng);
              const minOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
              return (
                <div className="text-[10px] text-gray-500 leading-relaxed">
                  Est. out: <span className="text-white">{out.toString()}</span> · Min out: <span className="text-white">{minOut.toString()}</span>
                  {burned > 0n ? ` · Burn: ${burned.toString()}` : ''}{fee > 0n ? ` · Fee: ${fee.toString()}` : ''}
                </div>
              );
            })()}
          </div>

          <div className="mt-4 border-t border-gray-800 pt-4 space-y-3">
            <div className="text-[10px] text-gray-500 tracking-widest">LIQUIDITY</div>
            <div className="text-[10px] text-gray-600">LP shares: <span className="text-white">{lpBalance?.balance ?? 0}</span></div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
                value={addLiqRng}
                onChange={(e) => setAddLiqRng(e.target.value)}
                placeholder="RNG"
              />
              <input
                className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
                value={addLiqVusdt}
                onChange={(e) => setAddLiqVusdt(e.target.value)}
                placeholder="vUSDT"
              />
            </div>
            <button
              className="w-full text-xs px-3 py-2 rounded border border-action-success text-action-success hover:bg-action-success/10"
              onClick={addLiquidity}
            >
              Add Liquidity
            </button>

            <div className="flex items-center gap-2">
              <input
                className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
                value={removeLiqShares}
                onChange={(e) => setRemoveLiqShares(e.target.value)}
                placeholder="Shares"
              />
              <button
                className="text-xs px-3 py-1 rounded border border-gray-700 text-gray-300 hover:border-gray-500"
                onClick={removeLiquidity}
              >
                Remove
              </button>
            </div>
          </div>
        </section>

        {/* Vault */}
        <section className="border border-gray-800 rounded p-4 bg-gray-900/30">
          <div className="text-xs text-gray-400 tracking-widest mb-3">VAULT (CDP)</div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="border border-gray-800 rounded p-3 bg-black/30">
              <div className="text-[10px] text-gray-500 tracking-widest">COLLATERAL RNG</div>
              <div className="text-white mt-1">{vault?.collateralRng ?? 0}</div>
            </div>
            <div className="border border-gray-800 rounded p-3 bg-black/30">
              <div className="text-[10px] text-gray-500 tracking-widest">DEBT vUSDT</div>
              <div className="text-white mt-1">{vault?.debtVusdt ?? 0}</div>
            </div>
            <div className="border border-gray-800 rounded p-3 bg-black/30">
              <div className="text-[10px] text-gray-500 tracking-widest">LTV</div>
              <div className="text-white mt-1">{(derived.ltvBps / 100).toFixed(2)}%</div>
              <div className="text-[10px] text-gray-600">max 30-45%</div>
            </div>
            <div className="border border-gray-800 rounded p-3 bg-black/30">
              <div className="text-[10px] text-gray-500 tracking-widest">AVAILABLE BORROW</div>
              <div className="text-white mt-1">{derived.availableDebt.toString()}</div>
              <div className="text-[10px] text-gray-600">vUSDT</div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <button
              className="w-full text-xs px-3 py-2 rounded border border-action-success text-action-success hover:bg-action-success/10"
              onClick={createVault}
            >
              Create Vault
            </button>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
                value={collateralAmount}
                onChange={(e) => setCollateralAmount(e.target.value)}
                placeholder="Deposit collateral (RNG)"
              />
              <button
                className="text-xs px-3 py-1 rounded border border-action-success text-action-success hover:bg-action-success/10"
                onClick={depositCollateral}
              >
                Deposit
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
                value={borrowAmount}
                onChange={(e) => setBorrowAmount(e.target.value)}
                placeholder="Borrow (vUSDT)"
              />
              <button
                className="text-xs px-3 py-1 rounded border border-action-destructive text-action-destructive hover:bg-action-destructive/10"
                onClick={borrowVusdt}
              >
                Borrow
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                placeholder="Repay (vUSDT)"
              />
              <button
                className="text-xs px-3 py-1 rounded border border-gray-700 text-gray-300 hover:border-gray-500"
                onClick={repayVusdt}
              >
                Repay
              </button>
            </div>
          </div>

          <div className="mt-4 border-t border-gray-800 pt-4">
            <div className="text-[10px] text-gray-500 tracking-widest mb-2">HOUSE (DEBUG)</div>
            <div className="text-[10px] text-gray-600 space-y-1">
              <div>Burned: <span className="text-white">{house?.totalBurned ?? 0}</span></div>
              <div>Issuance: <span className="text-white">{house?.totalIssuance ?? 0}</span></div>
              <div>Fees: <span className="text-white">{house?.accumulatedFees ?? 0}</span></div>
            </div>
          </div>
        </section>
      </div>

      <section className="mt-4 border border-gray-800 rounded p-4 bg-gray-900/30">
        <div className="text-xs text-gray-400 tracking-widest mb-3">ACTIVITY</div>
        <div className="space-y-1 text-[11px] text-gray-300">
          {activity.length === 0 ? <div className="text-gray-600">No activity yet.</div> : null}
          {activity.map((item) => (
            <div key={item.ts} className="flex items-center justify-between gap-3 border-b border-gray-900 py-1">
              <div className="truncate">{item.message}</div>
              <div className="text-[10px] text-gray-600">{new Date(item.ts).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
