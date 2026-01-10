import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchTransaction } from '../api/explorerClient';

const SIMPLE_INSTRUCTIONS = {
  CasinoToggleShield: 'Toggle shield modifier',
  CasinoToggleDouble: 'Toggle double modifier',
  CasinoToggleSuper: 'Toggle super mode',
  Unstake: 'Unstake',
  ClaimRewards: 'Claim staking rewards',
  ProcessEpoch: 'Process epoch',
  CreateVault: 'Create vault',
};

const INSTRUCTION_PATTERNS = [
  { regex: /^CasinoRegister\s*\{\s*name:\s*"(.*)"\s*\}$/, format: (m) => `Register casino player "${m[1]}"` },
  { regex: /^CasinoDeposit\s*\{\s*amount:\s*(\d+)\s*\}$/, format: (m) => `Deposit ${m[1]} RNG (faucet)` },
  { regex: /^CasinoStartGame\s*\{\s*game_type:\s*([A-Za-z]+)\s*,\s*bet:\s*(\d+)\s*,\s*session_id:\s*(\d+)\s*\}$/, format: (m) => `Start ${m[1]} game (bet ${m[2]} RNG, session ${m[3]})` },
  { regex: /^CasinoGameMove\s*\{\s*session_id:\s*(\d+)\s*,\s*payload:\s*\[([\s\S]*?)\]\s*,?\s*\}$/, format: (m) => {
    const bytes = m[2].trim() ? m[2].split(',').filter((v) => v.trim() !== '').length : 0;
    return bytes ? `Casino game move (session ${m[1]}, ${bytes} bytes)` : `Casino game move (session ${m[1]})`;
  }},
  { regex: /^CasinoJoinTournament\s*\{\s*tournament_id:\s*(\d+)\s*\}$/, format: (m) => `Join tournament ${m[1]}` },
  { regex: /^CasinoStartTournament\s*\{\s*tournament_id:\s*(\d+)\s*,\s*start_time_ms:\s*(\d+)\s*,\s*end_time_ms:\s*(\d+)\s*\}$/, format: (m) => `Start tournament ${m[1]} (start ${m[2]}, end ${m[3]})` },
  { regex: /^CasinoEndTournament\s*\{\s*tournament_id:\s*(\d+)\s*\}$/, format: (m) => `End tournament ${m[1]}` },
  { regex: /^Stake\s*\{\s*amount:\s*(\d+)\s*,\s*duration:\s*(\d+)\s*\}$/, format: (m) => `Stake ${m[1]} RNG for ${m[2]} blocks` },
  { regex: /^DepositCollateral\s*\{\s*amount:\s*(\d+)\s*\}$/, format: (m) => `Deposit ${m[1]} RNG as collateral` },
  { regex: /^BorrowUSDT\s*\{\s*amount:\s*(\d+)\s*\}$/, format: (m) => `Borrow ${m[1]} vUSDT` },
  { regex: /^RepayUSDT\s*\{\s*amount:\s*(\d+)\s*\}$/, format: (m) => `Repay ${m[1]} vUSDT` },
  { regex: /^Swap\s*\{\s*amount_in:\s*(\d+)\s*,\s*min_amount_out:\s*(\d+)\s*,\s*is_buying_rng:\s*(true|false)\s*\}$/, format: (m) => m[3] === 'true' ? `Swap ${m[1]} vUSDT for ≥ ${m[2]} RNG` : `Swap ${m[1]} RNG for ≥ ${m[2]} vUSDT` },
  { regex: /^AddLiquidity\s*\{\s*rng_amount:\s*(\d+)\s*,\s*usdt_amount:\s*(\d+)\s*\}$/, format: (m) => `Add liquidity (${m[1]} RNG + ${m[2]} vUSDT)` },
  { regex: /^RemoveLiquidity\s*\{\s*shares:\s*(\d+)\s*\}$/, format: (m) => `Remove liquidity (${m[1]} LP shares)` },
];

function getInstructionDescriptionFallback(instruction) {
  if (typeof instruction !== 'string') return '';
  const trimmed = instruction.trim();
  if (!trimmed) return '';

  if (SIMPLE_INSTRUCTIONS[trimmed]) {
    return SIMPLE_INSTRUCTIONS[trimmed];
  }

  for (const { regex, format } of INSTRUCTION_PATTERNS) {
    const match = trimmed.match(regex);
    if (match) return format(match);
  }

  return '';
}

export default function TxDetailPage() {
  const { hash } = useParams();
  const [tx, setTx] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    fetchTransaction(hash)
      .then((data) => mounted && setTx(data))
      .catch(() => setError('Transaction not found'));
    return () => {
      mounted = false;
    };
  }, [hash]);

  if (error) return <div className="text-action-destructive">{error}</div>;
  if (!tx) return <div className="text-ns-muted">Loading transaction...</div>;

  const description = tx.description || getInstructionDescriptionFallback(tx.instruction);

  return (
    <div className="space-y-6">
      <section className="liquid-card p-5">
        <div className="space-y-2">
          <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Transaction</div>
          <div className="text-lg font-display tracking-tight text-ns break-all">Tx {tx.hash}</div>
          <div className="flex flex-wrap gap-3 text-[11px] text-ns-muted">
            <div>
              Block:{' '}
              <Link to={`/explorer/blocks/${tx.block_height}`} className="text-ns hover:underline">
                #{tx.block_height}
              </Link>
            </div>
            <div>Position: <span className="text-ns">{tx.position}</span></div>
          </div>
        </div>
      </section>

      <section className="liquid-card p-5 text-[11px]">
        <div className="grid grid-cols-1 gap-2">
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Public Key</div>
            <div className="font-mono text-[10px] text-ns break-all mt-1">{tx.public_key}</div>
          </div>
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Nonce</div>
            <div className="text-ns">{tx.nonce}</div>
          </div>
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Description</div>
            <div className="text-ns mt-1 break-words">{description || '—'}</div>
          </div>
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Instruction</div>
            <div className="font-mono text-[10px] text-ns mt-1 break-words">{tx.instruction}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
