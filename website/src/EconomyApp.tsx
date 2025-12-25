import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { PlaySwapStakeTabs } from './components/PlaySwapStakeTabs';
import { WalletPill } from './components/WalletPill';
import { PageHeader } from './components/PageHeader';
import { AuthStatusPill } from './components/AuthStatusPill';
import { SwapPanel } from './components/economy/SwapPanel';
import { useSharedCasinoConnection } from './chain/CasinoConnectionContext';
import { useActivityFeed } from './hooks/useActivityFeed';
import { parseAmount } from './utils/amounts.js';
import { track } from './services/telemetry';
import { logActivity, trackTxConfirmed, trackTxFailed, trackTxSubmitted, type ActivityLevel, type TxKind } from './services/txTracker';
import { pushToast } from './services/toasts';

type EconomyTab = 'swap' | 'borrow' | 'liquidity';

const BorrowPanel = lazy(() =>
  import('./components/economy/BorrowPanel').then((m) => ({ default: m.BorrowPanel }))
);
const LiquidityPanel = lazy(() =>
  import('./components/economy/LiquidityPanel').then((m) => ({ default: m.LiquidityPanel }))
);

export default function EconomyApp() {
  const pathname = useLocation().pathname;
  const activeTab: EconomyTab = pathname.startsWith('/borrow')
    ? 'borrow'
    : pathname.startsWith('/liquidity')
      ? 'liquidity'
      : 'swap';
  const tabTitle = activeTab === 'swap' ? 'Swap' : activeTab === 'borrow' ? 'Borrow' : 'Liquidity';

  const [lastTxSig, setLastTxSig] = useState<string | null>(null);
  const [lastTxDigest, setLastTxDigest] = useState<string | null>(null);
  const activity = useActivityFeed('economy', 12);

  const connection = useSharedCasinoConnection();
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

  const pushActivity = (message: string, level: ActivityLevel = 'info') => {
    logActivity('economy', message, level);
  };

  const trackSubmitted = (kind: TxKind, message: string, result: any) => {
    trackTxSubmitted({
      surface: 'economy',
      kind,
      message,
      pubkeyHex: connection.keypair?.publicKeyHex,
      nonce: typeof result?.nonce === 'number' ? result.nonce : undefined,
      txHash: result?.txHash,
      txDigest: result?.txDigest,
    });
  };

  const statusText = useMemo(() => {
    switch (connection.status) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting…';
      case 'vault_locked':
      case 'missing_identity':
        return connection.statusDetail ?? 'Not ready';
      case 'error':
        return connection.statusDetail ?? connection.error ?? 'Failed to connect';
      default:
        return 'Connecting…';
    }
  }, [connection.error, connection.status, connection.statusDetail]);

  const getReadyClient = () => {
    const client: any = connection.client;
    if (!client?.nonceManager) {
      if (connection.status === 'vault_locked') {
        pushActivity('Vault locked — unlock to continue');
      } else {
        pushActivity('Client not ready');
      }
      return null;
    }
    return client;
  };

  const economyTabClass = ({ isActive }: { isActive: boolean }) =>
    [
      'flex-1 sm:flex-none inline-flex items-center justify-center h-11 px-3 rounded border text-[10px] tracking-widest uppercase transition-colors',
      isActive
        ? 'border-terminal-green text-terminal-green bg-terminal-green/10'
        : 'border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white',
    ].join(' ');

  useEffect(() => {
    if (connection.status === 'connected') {
      pushActivity('Connected');
    } else if (connection.status === 'vault_locked') {
      pushActivity('Vault locked — unlock to continue', 'error');
    } else if (connection.status === 'missing_identity') {
      pushActivity('Missing VITE_IDENTITY (see website/README.md).', 'error');
    } else if (connection.status === 'error') {
      pushActivity(connection.error ?? 'Failed to connect', 'error');
    }
  }, [connection.error, connection.status]);

  // Event toasts
  useEffect(() => {
    if (connection.status !== 'connected' || !connection.keypair) return;
    const pkHex = connection.keypair.publicKeyHex;
    const pkHexLower = pkHex.toLowerCase();
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
    const applyVault = (vault: any) => {
      if (vault) setVault(vault);
    };
    const applyAmm = (amm: any) => {
      if (amm) setAmm(amm);
    };
    const applyHouse = (house: any) => {
      if (house) setHouse(house);
    };
    const applyLpBalance = (balance: any) => {
      if (balance !== undefined && balance !== null) {
        setLpBalance({ balance });
      }
    };

    const unsubError = connection.onEvent('CasinoError', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const msg = e?.message ?? 'Unknown error';
      trackTxFailed({ surface: 'economy', finalMessage: msg, pubkeyHex: pkHex, error: msg });
      pushToast('error', msg);
      track('economy.error', { message: msg });
    });
    const unsubRegistered = connection.onEvent('CasinoPlayerRegistered', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const name = e?.name ?? '—';
      const msg = `Registered: ${name}`;
      trackTxConfirmed({ surface: 'economy', kind: 'register', finalMessage: msg, pubkeyHex: pkHex });
      pushToast('success', msg);
      pollRef.current?.();
      track('economy.register.confirmed', { name });
    });
    const unsubDeposited = connection.onEvent('CasinoDeposited', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const amount = e?.amount ?? 0;
      const newChips = e?.new_chips ?? e?.newChips ?? e?.new_chips ?? 0;
      const msg = `Deposit confirmed: +${amount} (chips=${newChips})`;
      trackTxConfirmed({
        surface: 'economy',
        kind: 'deposit',
        finalMessage: msg,
        pubkeyHex: pkHex,
      });
      pushToast('success', msg);
      pollRef.current?.();
      track('economy.deposit.confirmed', { amount, newChips });
    });
    const unsubVaultCreated = connection.onEvent('VaultCreated', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      trackTxConfirmed({ surface: 'economy', kind: 'create_vault', finalMessage: 'Vault created', pubkeyHex: pkHex });
      pushToast('success', 'Vault created');
      applyVault(e?.vault);
      track('economy.vault.created');
    });
    const unsubCollateral = connection.onEvent('CollateralDeposited', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const amount = e?.amount ?? 0;
      const msg = `Collateral deposited: ${amount}`;
      trackTxConfirmed({
        surface: 'economy',
        kind: 'deposit_collateral',
        finalMessage: msg,
        pubkeyHex: pkHex,
      });
      pushToast('success', msg);
      applyVault(e?.vault);
      applyPlayerBalances(e?.playerBalances);
      track('economy.vault.collateral_deposited', { amount });
    });
    const unsubBorrow = connection.onEvent('VusdtBorrowed', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const amount = e?.amount ?? 0;
      const msg = `Borrowed vUSDT: ${amount}`;
      trackTxConfirmed({ surface: 'economy', kind: 'borrow', finalMessage: msg, pubkeyHex: pkHex });
      pushToast('success', msg);
      applyVault(e?.vault);
      applyPlayerBalances(e?.playerBalances);
      track('economy.vault.borrowed', { amount });
    });
    const unsubRepay = connection.onEvent('VusdtRepaid', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const amount = e?.amount ?? 0;
      const msg = `Repaid vUSDT: ${amount}`;
      trackTxConfirmed({ surface: 'economy', kind: 'repay', finalMessage: msg, pubkeyHex: pkHex });
      pushToast('success', msg);
      applyVault(e?.vault);
      applyPlayerBalances(e?.playerBalances);
      track('economy.vault.repaid', { amount });
    });
    const unsubSwap = connection.onEvent('AmmSwapped', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const amountOut = e?.amountOut ?? e?.amount_out ?? 0;
      const msg = `Swap executed: out=${amountOut}`;
      trackTxConfirmed({ surface: 'economy', kind: 'swap', finalMessage: msg, pubkeyHex: pkHex });
      pushToast('success', msg);
      applyAmm(e?.amm);
      applyHouse(e?.house);
      applyPlayerBalances(e?.playerBalances);
      track('economy.swap.confirmed', { amountOut });
    });
    const unsubLiqAdd = connection.onEvent('LiquidityAdded', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const sharesMinted = e?.sharesMinted ?? e?.shares_minted ?? 0;
      const msg = `Liquidity added: shares=${sharesMinted}`;
      trackTxConfirmed({
        surface: 'economy',
        kind: 'add_liquidity',
        finalMessage: msg,
        pubkeyHex: pkHex,
      });
      pushToast('success', msg);
      applyAmm(e?.amm);
      applyLpBalance(e?.lpBalance);
      applyPlayerBalances(e?.playerBalances);
      track('economy.liquidity.added', { sharesMinted });
    });
    const unsubLiqRemove = connection.onEvent('LiquidityRemoved', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const sharesBurned = e?.sharesBurned ?? e?.shares_burned ?? 0;
      const msg = `Liquidity removed: shares=${sharesBurned}`;
      trackTxConfirmed({
        surface: 'economy',
        kind: 'remove_liquidity',
        finalMessage: msg,
        pubkeyHex: pkHex,
      });
      pushToast('success', msg);
      applyAmm(e?.amm);
      applyLpBalance(e?.lpBalance);
      applyPlayerBalances(e?.playerBalances);
      track('economy.liquidity.removed', { sharesBurned });
    });

    return () => {
      try {
        unsubError?.();
        unsubRegistered?.();
        unsubDeposited?.();
        unsubVaultCreated?.();
        unsubCollateral?.();
        unsubBorrow?.();
        unsubRepay?.();
        unsubSwap?.();
        unsubLiqAdd?.();
        unsubLiqRemove?.();
      } catch {
        // ignore
      }
    };
  }, [connection.keypair?.publicKeyHex, connection.onEvent, connection.status]);

  // Poll state
  useEffect(() => {
    const client: any = connection.client;
    const pk = connection.keypair?.publicKey;
    if (!client || !pk) return;

    let cancelled = false;
    let inFlight = false;
    const poll = async (force = false) => {
      if (cancelled || inFlight) return;
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
      } catch {
        // ignore transient errors
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
  }, [connection.client, connection.keypair?.publicKeyHex]);

  const ammDerived = useMemo(() => {
    const reserveRng = BigInt(amm?.reserveRng ?? 0);
    const reserveVusdt = BigInt(amm?.reserveVusdt ?? 0);
    const price = reserveRng > 0n ? Number(reserveVusdt) / Number(reserveRng) : null;
    const tvlVusdt = reserveVusdt * 2n;
    return { reserveRng, reserveVusdt, price, tvlVusdt };
  }, [amm]);

  const vaultDerived = useMemo(() => {
    const collateral = BigInt(vault?.collateralRng ?? 0);
    const debt = BigInt(vault?.debtVusdt ?? 0);
    const priceNum = ammDerived.reserveRng > 0n ? ammDerived.reserveVusdt : 1n;
    const priceDen = ammDerived.reserveRng > 0n ? ammDerived.reserveRng : 1n;
    const collateralValue = priceDen > 0n ? (collateral * priceNum) / priceDen : 0n;
    const ltvBps = collateralValue > 0n ? Number((debt * 10_000n) / collateralValue) : 0;
    const maxDebt = collateralValue / 2n;
    const availableDebt = maxDebt > debt ? maxDebt - debt : 0n;
    return { ltvBps, availableDebt };
  }, [ammDerived.reserveRng, ammDerived.reserveVusdt, vault]);

  const ensureRegistered = async () => {
    const client = getReadyClient();
    if (!client) return;
    if (isRegistered) return;
    const name = registerName.trim() || `Trader_${Date.now().toString(36)}`;
    const result = await client.nonceManager.submitCasinoRegister(name);
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('economy.register.submitted', { name });
    trackSubmitted('register', `Submitted register (${name})`, result);
  };

  const claimFaucet = async () => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    const result = await client.nonceManager.submitCasinoDeposit(1000);
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('economy.faucet.submitted', { amount: 1000 });
    trackSubmitted('deposit', 'Submitted faucet claim (1000 RNG)', result);
  };

  const createVault = async () => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    const result = await client.nonceManager.submitCreateVault();
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('economy.vault.create.submitted');
    trackSubmitted('create_vault', 'Submitted create vault', result);
  };

  const depositCollateral = async () => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    if (!vault) {
      pushActivity('Create a vault first');
      return;
    }
    if (!player) {
      pushActivity('Register to continue');
      return;
    }
    const amt = parseAmount(collateralAmount);
    if (amt === null || amt <= 0n) {
      pushActivity('Collateral amount must be greater than zero');
      return;
    }
    const chips = BigInt(player?.chips ?? 0);
    if (amt > chips) {
      pushActivity('Not enough RNG');
      return;
    }
    const result = await client.nonceManager.submitDepositCollateral(amt.toString());
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('economy.vault.deposit_collateral.submitted', { amount: amt.toString() });
    trackSubmitted('deposit_collateral', `Submitted deposit collateral (${amt})`, result);
  };

  const borrowVusdt = async () => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    if (!vault) {
      pushActivity('Create a vault first');
      return;
    }
    const amt = parseAmount(borrowAmount);
    if (amt === null || amt <= 0n) {
      pushActivity('Borrow amount must be greater than zero');
      return;
    }
    if (BigInt(vault?.collateralRng ?? 0) <= 0n) {
      pushActivity('Deposit collateral first');
      return;
    }
    if (amt > vaultDerived.availableDebt) {
      pushActivity('Borrow exceeds available');
      return;
    }
    const result = await client.nonceManager.submitBorrowUsdt(amt.toString());
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('economy.vault.borrow.submitted', { amount: amt.toString() });
    trackSubmitted('borrow', `Submitted borrow (${amt} vUSDT)`, result);
  };

  const repayVusdt = async () => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    if (!vault) {
      pushActivity('Create a vault first');
      return;
    }
    if (!player) {
      pushActivity('Register to continue');
      return;
    }
    const amt = parseAmount(repayAmount);
    if (amt === null || amt <= 0n) {
      pushActivity('Repay amount must be greater than zero');
      return;
    }
    const balance = BigInt(player?.vusdtBalance ?? 0);
    if (amt > balance) {
      pushActivity('Not enough vUSDT');
      return;
    }
    const debt = BigInt(vault?.debtVusdt ?? 0);
    if (amt > debt) {
      pushActivity('Repay exceeds debt');
      return;
    }
    const result = await client.nonceManager.submitRepayUsdt(amt.toString());
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('economy.vault.repay.submitted', { amount: amt.toString() });
    trackSubmitted('repay', `Submitted repay (${amt} vUSDT)`, result);
  };

  const submitSwap = async ({
    amountIn,
    minOut,
    isBuyingRng,
  }: {
    amountIn: bigint;
    minOut: bigint;
    isBuyingRng: boolean;
  }) => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    if (!player) {
      pushActivity('Register to trade');
      return;
    }
    if (typeof amountIn !== 'bigint' || amountIn <= 0n) {
      pushActivity('Invalid swap amount');
      return;
    }
    const balance = isBuyingRng ? BigInt(player?.vusdtBalance ?? 0) : BigInt(player?.chips ?? 0);
    if (amountIn > balance) {
      pushActivity(isBuyingRng ? 'Not enough vUSDT' : 'Not enough RNG');
      return;
    }
    const result = await client.nonceManager.submitSwap(amountIn.toString(), minOut.toString(), isBuyingRng);
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('economy.swap.submitted', {
      amountIn: amountIn.toString(),
      minOut: minOut.toString(),
      direction: isBuyingRng ? 'BUY_RNG' : 'SELL_RNG',
      slippageBps,
    });
    trackSubmitted('swap', `Submitted swap in=${amountIn} minOut=${minOut}`, result);
  };

  const addLiquidity = async () => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    if (!player) {
      pushActivity('Register to continue');
      return;
    }
    const rngAmt = parseAmount(addLiqRng);
    const vusdtAmt = parseAmount(addLiqVusdt);
    if (rngAmt === null || vusdtAmt === null || rngAmt <= 0n || vusdtAmt <= 0n) {
      pushActivity('Liquidity amounts must be greater than zero');
      return;
    }
    const chips = BigInt(player?.chips ?? 0);
    const vusdt = BigInt(player?.vusdtBalance ?? 0);
    if (rngAmt > chips) {
      pushActivity('Not enough RNG');
      return;
    }
    if (vusdtAmt > vusdt) {
      pushActivity('Not enough vUSDT');
      return;
    }
    const result = await client.nonceManager.submitAddLiquidity(rngAmt.toString(), vusdtAmt.toString());
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('economy.liquidity.add.submitted', { rng: rngAmt.toString(), vusdt: vusdtAmt.toString() });
    trackSubmitted('add_liquidity', `Submitted add liquidity (RNG=${rngAmt}, vUSDT=${vusdtAmt})`, result);
  };

  const removeLiquidity = async () => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    const shares = parseAmount(removeLiqShares);
    if (shares === null || shares <= 0n) {
      pushActivity('Share amount must be greater than zero');
      return;
    }
    const balance = BigInt(lpBalance?.balance ?? 0);
    if (shares > balance) {
      pushActivity('Not enough LP shares');
      return;
    }
    const result = await client.nonceManager.submitRemoveLiquidity(shares.toString());
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('economy.liquidity.remove.submitted', { shares: shares.toString() });
    trackSubmitted('remove_liquidity', `Submitted remove liquidity (shares=${shares})`, result);
  };

  // Keyboard shortcuts for economy actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      const k = e.key.toLowerCase();

      // Global shortcuts
      if (k === 'f' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        claimFaucet();
        return;
      }

      // Tab-specific shortcuts
      if (activeTab === 'swap') {
        if (k === 't') {
          e.preventDefault();
          setSwapDirection((prev) => (prev === 'BUY_RNG' ? 'SELL_RNG' : 'BUY_RNG'));
        }
      } else if (activeTab === 'borrow') {
        if (k === 'v') {
          e.preventDefault();
          createVault();
        } else if (k === 'c') {
          e.preventDefault();
          depositCollateral();
        } else if (k === 'b') {
          e.preventDefault();
          borrowVusdt();
        } else if (k === 'r') {
          e.preventDefault();
          repayVusdt();
        }
      } else if (activeTab === 'liquidity') {
        if (k === 'a') {
          e.preventDefault();
          addLiquidity();
        } else if (k === 'x') {
          e.preventDefault();
          removeLiquidity();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, swapDirection]);

  return (
    <div className="min-h-screen bg-terminal-black text-white font-mono">
      <PageHeader
        title={`Economy — ${tabTitle}`}
        status={statusText}
        leading={<PlaySwapStakeTabs />}
        right={
          <>
            <AuthStatusPill publicKeyHex={connection.keypair?.publicKeyHex ?? null} />
            <WalletPill rng={player?.chips} vusdt={player?.vusdtBalance} pubkeyHex={connection.keypair?.publicKeyHex} />
            {lastTxSig ? (
              lastTxDigest ? (
                <Link
                  to={`/explorer/tx/${lastTxDigest}`}
                  className="text-[10px] text-terminal-green tracking-widest hover:underline"
                  title={lastTxDigest}
                >
                  LAST TX: {lastTxSig}
                </Link>
              ) : (
                <div className="text-[10px] text-gray-500 tracking-widest">LAST TX: {lastTxSig}</div>
              )
            ) : null}
          </>
        }
      />

      <div className="px-4 py-3 border-b border-gray-800 bg-terminal-black/90 backdrop-blur">
        <nav className="flex items-center gap-2">
          <NavLink to="/swap" end className={economyTabClass}>
            Swap
          </NavLink>
          <NavLink to="/borrow" className={economyTabClass}>
            Borrow
          </NavLink>
          <NavLink to="/liquidity" className={economyTabClass}>
            Liquidity
          </NavLink>
        </nav>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Wallet */}
        <section className="border border-gray-800 rounded p-4 bg-gray-900/30 lg:col-span-1">
	          <div className="text-xs text-gray-400 tracking-widest mb-3">WALLET</div>
	          <div className="space-y-2 text-sm">
	            <div>Registered: <span className={isRegistered ? 'text-terminal-green' : 'text-terminal-accent'}>{isRegistered ? 'YES' : 'NO'}</span></div>
	            <div>RNG: <span className="text-white">{player?.chips ?? 0}</span></div>
	            <div>vUSDT: <span className="text-white">{player?.vusdtBalance ?? 0}</span></div>
	            <div className="text-[10px] text-gray-600 break-all">PK: {connection.keypair?.publicKeyHex ?? '—'}</div>
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
                className="text-xs px-3 py-1 rounded border border-terminal-green text-terminal-green hover:bg-terminal-green/10"
                onClick={ensureRegistered}
              >
                Register
              </button>
            </div>
            <button
              className="w-full text-xs px-3 py-2 rounded border border-terminal-green bg-terminal-green/10 text-terminal-green hover:bg-terminal-green/20"
              onClick={claimFaucet}
            >
              Daily Faucet (1000 RNG)
            </button>
	          </div>
        </section>

        {activeTab === 'swap' ? (
          <SwapPanel
            amm={amm}
            ammDerived={ammDerived}
            player={player}
            swapDirection={swapDirection}
            slippageBps={slippageBps}
            swapAmountIn={swapAmountIn}
            setSwapDirection={setSwapDirection}
            setSlippageBps={setSlippageBps}
            setSwapAmountIn={setSwapAmountIn}
            onSubmitSwap={submitSwap}
          />
        ) : null}

        {activeTab === 'liquidity' ? (
          <Suspense
            fallback={
              <section className="border border-gray-800 rounded p-4 bg-gray-900/30 lg:col-span-2">
                <div className="text-xs text-gray-400 tracking-widest mb-3">AMM (RNG/vUSDT)</div>
                <div className="text-[11px] text-gray-600">Loading…</div>
              </section>
            }
          >
            <LiquidityPanel
              amm={amm}
              ammDerived={ammDerived}
              lpBalance={lpBalance}
              addLiqRng={addLiqRng}
              addLiqVusdt={addLiqVusdt}
              removeLiqShares={removeLiqShares}
              setAddLiqRng={setAddLiqRng}
              setAddLiqVusdt={setAddLiqVusdt}
              setRemoveLiqShares={setRemoveLiqShares}
              onAddLiquidity={addLiquidity}
              onRemoveLiquidity={removeLiquidity}
            />
          </Suspense>
        ) : null}

        {activeTab === 'borrow' ? (
          <Suspense
            fallback={
              <section className="border border-gray-800 rounded p-4 bg-gray-900/30 lg:col-span-2">
                <div className="text-xs text-gray-400 tracking-widest mb-3">VAULT (CDP)</div>
                <div className="text-[11px] text-gray-600">Loading…</div>
              </section>
            }
          >
            <BorrowPanel
              vault={vault}
              vaultDerived={vaultDerived}
              house={house}
              collateralAmount={collateralAmount}
              borrowAmount={borrowAmount}
              repayAmount={repayAmount}
              setCollateralAmount={setCollateralAmount}
              setBorrowAmount={setBorrowAmount}
              setRepayAmount={setRepayAmount}
              onCreateVault={createVault}
              onDepositCollateral={depositCollateral}
              onBorrowVusdt={borrowVusdt}
              onRepayVusdt={repayVusdt}
            />
          </Suspense>
        ) : null}
        </div>

      <section className="mt-4 border border-gray-800 rounded p-4 bg-gray-900/30">
        <div className="text-xs text-gray-400 tracking-widest mb-3">ACTIVITY</div>
        <div className="space-y-1 text-[11px] text-gray-300">
          {activity.length === 0 ? <div className="text-gray-600">No activity yet.</div> : null}
          {activity.map((item) => {
            const isTx = item.type === 'tx';
            const message = isTx ? item.finalMessage ?? item.message : item.message;
            const when = new Date(isTx ? item.updatedTs : item.ts).toLocaleTimeString();
            const label = isTx
              ? item.status === 'submitted'
                ? 'PENDING'
                : item.status === 'confirmed'
                  ? 'OK'
                  : 'FAIL'
              : item.level === 'error'
                ? 'ERROR'
                : item.level === 'success'
                  ? 'OK'
                  : 'INFO';
            const labelClass = isTx
              ? item.status === 'confirmed'
                ? 'text-terminal-green'
                : item.status === 'failed'
                  ? 'text-terminal-accent'
                  : 'text-gray-500'
              : item.level === 'error'
                ? 'text-terminal-accent'
                : item.level === 'success'
                  ? 'text-terminal-green'
                  : 'text-gray-500';

            const messageNode =
              isTx && item.txDigest ? (
                <Link to={`/explorer/tx/${item.txDigest}`} className="truncate hover:underline" title={item.txDigest}>
                  {message}
                </Link>
              ) : (
                <div className="truncate">{message}</div>
              );

            return (
              <div key={item.id} className="flex items-center justify-between gap-3 border-b border-gray-900 py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`text-[10px] tracking-widest ${labelClass}`}>{label}</div>
                  <div className="min-w-0 flex-1">{messageNode}</div>
                </div>
                <div className="text-[10px] text-gray-600">{when}</div>
              </div>
            );
          })}
        </div>
      </section>
      </div>
    </div>
  );
}
