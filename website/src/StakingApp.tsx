import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlaySwapStakeTabs } from './components/PlaySwapStakeTabs';
import { WalletPill } from './components/WalletPill';
import { PageHeader } from './components/PageHeader';
import { useSharedCasinoConnection } from './chain/CasinoConnectionContext';
import { useActivityFeed } from './hooks/useActivityFeed';
import { parseAmount } from './utils/amounts.js';
import { track } from './services/telemetry';
import { logActivity, trackTxConfirmed, trackTxFailed, trackTxSubmitted, type ActivityLevel, type TxKind } from './services/txTracker';
import { pushToast } from './services/toasts';
import { StakingDashboard } from './components/staking/StakingDashboard';
import { StakeFlow } from './components/staking/StakeFlow';
import { StakingAdvanced } from './components/staking/StakingAdvanced';

export default function StakingApp() {
  const [lastTxSig, setLastTxSig] = useState<string | null>(null);
  const [lastTxDigest, setLastTxDigest] = useState<string | null>(null);
  const activity = useActivityFeed('staking', 12);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const connection = useSharedCasinoConnection();
  const pollRef = useRef<(() => void) | null>(null);

  const [isRegistered, setIsRegistered] = useState(false);
  const [player, setPlayer] = useState<any | null>(null);
  const [staker, setStaker] = useState<any | null>(null);
  const [house, setHouse] = useState<any | null>(null);

  const [registerName, setRegisterName] = useState('Staker');
  const [stakeAmount, setStakeAmount] = useState('0');
  const [stakeDuration, setStakeDuration] = useState('100');

  const pushActivity = (message: string, level: ActivityLevel = 'info') => {
    logActivity('staking', message, level);
  };

  const trackSubmitted = (kind: TxKind, message: string, result: any) => {
    trackTxSubmitted({
      surface: 'staking',
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

    const unsubError = connection.onEvent('CasinoError', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const msg = e?.message ?? 'Unknown error';
      trackTxFailed({ surface: 'staking', finalMessage: msg, pubkeyHex: pkHex, error: msg });
      pushToast('error', msg);
      track('staking.error', { message: msg });
    });
    const unsubRegistered = connection.onEvent('CasinoPlayerRegistered', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const name = e?.name ?? '—';
      const msg = `Registered: ${name}`;
      trackTxConfirmed({ surface: 'staking', kind: 'register', finalMessage: msg, pubkeyHex: pkHex });
      pushToast('success', msg);
      pollRef.current?.();
      track('staking.register.confirmed', { name });
    });
    const unsubDeposited = connection.onEvent('CasinoDeposited', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const amount = e?.amount ?? 0;
      const newChips = e?.new_chips ?? e?.newChips ?? 0;
      const msg = `Deposit confirmed: +${amount} (chips=${newChips})`;
      trackTxConfirmed({
        surface: 'staking',
        kind: 'deposit',
        finalMessage: msg,
        pubkeyHex: pkHex,
      });
      pushToast('success', msg);
      pollRef.current?.();
      track('staking.deposit.confirmed', { amount, newChips });
    });
    const unsubStaked = connection.onEvent('Staked', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const amount = e?.amount ?? 0;
      const unlockTs = e?.unlockTs ?? e?.unlock_ts ?? '—';
      const msg = `Staked: +${amount} (unlock @ ${unlockTs})`;
      trackTxConfirmed({
        surface: 'staking',
        kind: 'stake',
        finalMessage: msg,
        pubkeyHex: pkHex,
      });
      pushToast('success', msg);
      pollRef.current?.();
      track('staking.stake.confirmed', { amount, unlockTs });
    });
    const unsubUnstaked = connection.onEvent('Unstaked', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const amount = e?.amount ?? 0;
      const msg = `Unstaked: ${amount}`;
      trackTxConfirmed({ surface: 'staking', kind: 'unstake', finalMessage: msg, pubkeyHex: pkHex });
      pushToast('success', msg);
      pollRef.current?.();
      track('staking.unstake.confirmed', { amount });
    });
    const unsubClaimed = connection.onEvent('RewardsClaimed', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const amount = e?.amount ?? 0;
      const msg = `Rewards claimed: ${amount}`;
      trackTxConfirmed({
        surface: 'staking',
        kind: 'claim_rewards',
        finalMessage: msg,
        pubkeyHex: pkHex,
      });
      pushToast('success', msg);
      pollRef.current?.();
      track('staking.claim.confirmed', { amount });
    });
    const unsubEpoch = connection.onEvent('EpochProcessed', (e: any) => {
      const epoch = e?.epoch ?? '—';
      const msg = `Epoch processed: ${epoch}`;
      trackTxConfirmed({ surface: 'staking', kind: 'process_epoch', finalMessage: msg });
      pushToast('success', msg);
      track('staking.epoch.processed', { epoch });
    });

    return () => {
      try {
        unsubError?.();
        unsubRegistered?.();
        unsubDeposited?.();
        unsubStaked?.();
        unsubUnstaked?.();
        unsubClaimed?.();
        unsubEpoch?.();
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
    const poll = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const [p, s, h] = await Promise.all([
          client.getCasinoPlayer(pk),
          client.getStaker(pk),
          client.getHouse(),
        ]);
        setPlayer(p);
        setIsRegistered(!!p);
        setStaker(s);
        setHouse(h);
      } catch {
        // ignore transient errors
      } finally {
        inFlight = false;
      }
    };

    void poll();
    pollRef.current = () => {
      void poll();
    };
    const interval = setInterval(poll, 3000);

    return () => {
      cancelled = true;
      pollRef.current = null;
      clearInterval(interval);
    };
  }, [connection.client, connection.keypair?.publicKeyHex]);

  const derived = useMemo(() => {
    const staked = BigInt(staker?.balance ?? 0);
    const unlockTs = Number(staker?.unlockTs ?? 0);
    const vp = BigInt(staker?.votingPower ?? 0);
    const unclaimedRewards = BigInt(staker?.unclaimedRewards ?? 0);
    const rewardDebtX18 = BigInt(staker?.rewardDebtX18 ?? 0);
    const totalVp = BigInt(house?.totalVotingPower ?? 0);
    const totalStaked = BigInt(house?.totalStakedAmount ?? 0);
    const rewardPerVotingPowerX18 = BigInt(house?.stakingRewardPerVotingPowerX18 ?? 0);
    const rewardPool = BigInt(house?.stakingRewardPool ?? 0);

    const view = connection.currentView ?? 0;
    const locked = unlockTs > 0 && view < unlockTs;
    const remainingBlocks = locked ? unlockTs - view : 0;

    const shareBps = totalVp > 0n ? Number((vp * 10_000n) / totalVp) : 0;
    const stakedShareBps = totalStaked > 0n ? Number((staked * 10_000n) / totalStaked) : 0;

    const STAKING_REWARD_SCALE = 1_000_000_000_000_000_000n;
    let pendingRewards = 0n;
    if (vp > 0n) {
      const currentDebtX18 = vp * rewardPerVotingPowerX18;
      pendingRewards =
        currentDebtX18 > rewardDebtX18
          ? (currentDebtX18 - rewardDebtX18) / STAKING_REWARD_SCALE
          : 0n;
    }
    const claimableRewards = unclaimedRewards + pendingRewards;

    return {
      staked,
      unlockTs,
      vp,
      unclaimedRewards,
      pendingRewards,
      claimableRewards,
      totalVp,
      totalStaked,
      locked,
      remainingBlocks,
      shareBps,
      stakedShareBps,
      rewardPool,
    };
  }, [connection.currentView, house, staker]);

  const stakeBalance = useMemo(() => BigInt(player?.chips ?? 0), [player?.chips]);
  const stakeAmountParsed = useMemo(() => parseAmount(stakeAmount), [stakeAmount]);
  const stakeDurationParsed = useMemo(() => parseAmount(stakeDuration), [stakeDuration]);
  const stakeValidationMessage = useMemo(() => {
    if (!player) return 'Register to stake';
    if (stakeAmountParsed === null) return 'Enter a whole number amount';
    if (stakeAmountParsed <= 0n) return 'Amount must be greater than zero';
    if (stakeAmountParsed > stakeBalance) return 'Not enough RNG';
    if (stakeDurationParsed === null) return 'Enter a whole number duration';
    if (stakeDurationParsed <= 0n) return 'Duration must be greater than zero';
    return null;
  }, [player, stakeAmountParsed, stakeBalance, stakeDurationParsed]);
  const canStake = !stakeSubmitting && stakeValidationMessage === null;

  const setStakePercent = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.floor(pct)));
    const value = (stakeBalance * BigInt(clamped)) / 100n;
    setStakeAmount(value.toString());
  };

  const ensureRegistered = async () => {
    const client = getReadyClient();
    if (!client) return;
    if (isRegistered) return;
    const name = registerName.trim() || `Staker_${Date.now().toString(36)}`;
    const result = await client.nonceManager.submitCasinoRegister(name);
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('staking.register.submitted', { name });
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
    track('staking.faucet.submitted', { amount: 1000 });
    trackSubmitted('deposit', 'Submitted faucet claim (1000 RNG)', result);
  };

  const stake = async (amount: bigint, duration: bigint) => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();

    if (!player) {
      pushActivity('Register to stake');
      return;
    }
    if (amount <= 0n || duration <= 0n) {
      pushActivity('Stake amount/duration must be > 0');
      return;
    }
    if (amount > stakeBalance) {
      pushActivity('Not enough RNG');
      return;
    }
    const result = await client.nonceManager.submitStake(amount.toString(), duration.toString());
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('staking.stake.submitted', { amount: amount.toString(), duration: duration.toString() });
    trackSubmitted('stake', `Submitted stake (amount=${amount}, duration=${duration})`, result);
  };

  const unstake = async () => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    const result = await client.nonceManager.submitUnstake();
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('staking.unstake.submitted');
    trackSubmitted('unstake', 'Submitted unstake', result);
  };

  const claimRewards = async () => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    const result = await client.nonceManager.submitClaimRewards();
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('staking.claim.submitted');
    trackSubmitted('claim_rewards', 'Submitted claim rewards', result);
  };

  const processEpoch = async () => {
    const client = getReadyClient();
    if (!client) return;
    await ensureRegistered();
    const result = await client.nonceManager.submitProcessEpoch();
    if (result?.txHash) {
      setLastTxSig(result.txHash);
      setLastTxDigest(result.txDigest ?? null);
    }
    track('staking.epoch.process.submitted');
    trackSubmitted('process_epoch', 'Submitted process epoch', result);
  };

  return (
    <div className="min-h-screen bg-terminal-black text-white font-mono">
      <PageHeader
        title="Staking"
        status={statusText}
        leading={<PlaySwapStakeTabs />}
        right={
          <>
            <WalletPill rng={player?.chips} vusdt={player?.vusdtBalance} pubkeyHex={connection.keypair?.publicKeyHex} />
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className={[
                'h-11 px-3 rounded border text-[10px] tracking-widest uppercase transition-colors',
                showAdvanced
                  ? 'border-terminal-green text-terminal-green bg-terminal-green/10'
                  : 'border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white',
              ].join(' ')}
              title="Show advanced / dev controls"
            >
              Advanced
            </button>
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

      <div className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Wallet */}
          <section className="border border-gray-800 rounded p-4 bg-gray-900/30">
            <div className="text-xs text-gray-400 tracking-widest mb-3">WALLET</div>
            <div className="space-y-2 text-sm">
              <div>
                Registered:{' '}
                <span className={isRegistered ? 'text-terminal-green' : 'text-terminal-accent'}>
                  {isRegistered ? 'YES' : 'NO'}
                </span>
              </div>
              <div>
                RNG: <span className="text-white">{player?.chips ?? 0}</span>
              </div>
              <div>
                vUSDT: <span className="text-white">{player?.vusdtBalance ?? 0}</span>
              </div>
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
                className="w-full text-xs px-3 py-2 rounded border border-terminal-green text-terminal-green hover:bg-terminal-green/10"
                onClick={claimFaucet}
              >
                Daily Faucet (1000 RNG)
              </button>
            </div>
          </section>

          {/* Stake */}
          <section
            className={[
              'border border-gray-800 rounded p-4 bg-gray-900/30',
              showAdvanced ? '' : 'lg:col-span-2',
            ]
              .join(' ')
              .trim()}
          >
            <div className="text-xs text-gray-400 tracking-widest mb-3">STAKE RNG</div>

            <StakingDashboard staker={staker} derived={derived} />

            <div className="mt-4">
              <StakeFlow
                player={player}
                derived={derived}
                stakeBalance={stakeBalance}
                stakeAmount={stakeAmount}
                stakeDuration={stakeDuration}
                stakeAmountParsed={stakeAmountParsed}
                stakeDurationParsed={stakeDurationParsed}
                canStake={canStake}
                stakeValidationMessage={stakeValidationMessage}
                setStakeAmount={setStakeAmount}
                setStakeDuration={setStakeDuration}
                setStakePercent={setStakePercent}
                onStake={stake}
                onUnstake={unstake}
                onClaimRewards={claimRewards}
              />
            </div>
          </section>

          {/* House */}
          {showAdvanced ? (
            <StakingAdvanced
              house={house}
              derived={derived}
              currentView={connection.currentView}
              onProcessEpoch={processEpoch}
            />
          ) : null}
        </div>

        {/* Activity */}
        <section className="mt-4 border border-gray-800 rounded p-4 bg-gray-900/20">
          <div className="text-xs text-gray-400 tracking-widest mb-3">ACTIVITY</div>
          {activity.length === 0 ? (
            <div className="text-[10px] text-gray-600">No activity yet.</div>
          ) : (
            <ul className="space-y-1 text-[10px] text-gray-400">
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
                    <Link
                      to={`/explorer/tx/${item.txDigest}`}
                      className="text-gray-300 hover:underline"
                      title={item.txDigest}
                    >
                      {message}
                    </Link>
                  ) : (
                    <span className="text-gray-300">{message}</span>
                  );

                return (
                  <li key={item.id} className="flex items-start gap-2">
                    <span className="text-gray-600">{when}</span>
                    <span className={`text-[10px] tracking-widest ${labelClass}`}>{label}</span>
                    {messageNode}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
