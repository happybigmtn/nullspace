
import { Card, Suit, Rank, CrapsBet, RouletteBet, SicBoBet, GameType, SuperMultiplier } from '../types';

// --- CONSTANTS ---
export const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const WAYS: { [key: number]: number } = { 2:1, 3:2, 4:3, 5:4, 6:5, 7:6, 8:5, 9:4, 10:3, 11:2, 12:1 };

// Roulette Constants
export const ROULETTE_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];
export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

export const HELP_CONTENT: Record<string, any> = {
    [GameType.BLACKJACK]: {
        title: "BLACKJACK",
        win: "Beat dealer's hand without going over 21. Blackjack (A+10/J/Q/K) pays 3:2.",
        loss: "Bust (over 21) or dealer has higher hand.",
        example: "Your Hand: K, 7 (17). Dealer: 6. Stand."
    },
    [GameType.CRAPS]: {
        title: "CRAPS",
        win: "Pass Line: Win on 7/11 (Come Out). Win if Point repeats before 7.",
        loss: "Pass Line: Lose on 2/3/12 (Come Out). Lose if 7 rolls before Point.",
        example: "Roll 4 (Point). Roll 4 again to win."
    },
    [GameType.ROULETTE]: {
        title: "ROULETTE",
        win: "Predict number/color where ball lands. Straight up pays 35:1.",
        loss: "Ball lands on unpicked number/color.",
        example: "Bet Red. Ball lands 32 (Red). Win 1:1."
    },
    [GameType.SIC_BO]: {
        title: "SIC BO",
        win: "Predict dice combinations. Small (4-10) / Big (11-17) pays 1:1.",
        loss: "Dice result doesn't match bet. Triples lose Small/Big bets.",
        example: "Bet Big. Roll 4-5-6 (15). Win."
    },
    [GameType.BACCARAT]: {
        title: "BACCARAT",
        win: "Bet on hand closest to 9. Player 1:1, Banker 0.95:1.",
        loss: "Selected hand lower than opponent.",
        example: "Player 7, Banker 6. Player wins."
    },
    [GameType.HILO]: {
        title: "HILO",
        win: "Guess if next card is Higher or Lower. Win accumulates in pot.",
        loss: "Incorrect guess loses accumulated pot.",
        example: "Card 5. Guess Higher. Next is J. Win."
    },
    [GameType.VIDEO_POKER]: {
        title: "VIDEO POKER",
        win: "Make poker hand (Jacks or Better+). Royal Flush pays 800x.",
        loss: "Hand lower than Pair of Jacks.",
        example: "Hold Pair of Kings. Draw 3 of a Kind. Win."
    },
    [GameType.THREE_CARD]: {
        title: "THREE CARD POKER",
        win: "Beat dealer with higher poker hand. Dealer needs Q-high to qualify.",
        loss: "Dealer has higher hand.",
        example: "You: Pair 8s. Dealer: A-K-2. You win."
    },
    [GameType.ULTIMATE_HOLDEM]: {
        title: "ULTIMATE TEXAS HOLDEM",
        win: "Beat dealer's best 5-card hand. Play bet multiplies based on street.",
        loss: "Dealer has higher hand.",
        example: "You: A-K. Flop: A-5-2. Bet 4x Pre-flop wins."
    },
    [GameType.CASINO_WAR]: {
        title: "CASINO WAR",
        win: "Higher card than dealer. Tie goes to War.",
        loss: "Lower card than dealer.",
        example: "You: King. Dealer: 10. Win."
    }
};

// --- DECK & RANDOM ---
export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  SUITS.forEach(suit => {
    RANKS.forEach(rank => {
      let value = parseInt(rank);
      if (isNaN(value)) value = rank === 'A' ? 11 : 10;
      deck.push({ suit, rank, value });
    });
  });
  return deck.sort(() => Math.random() - 0.5);
};

export const rollDie = () => Math.floor(Math.random() * 6) + 1;
export const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
export const randomItem = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// --- SUPER MODE LOGIC ---
export const getSuperModeFee = (gameType: GameType, bet: number): number => {
    return Math.floor(bet * 0.20);
};

export const generateSuperMultipliers = (gameType: GameType): SuperMultiplier[] => {
    const mults: SuperMultiplier[] = [];
    
    if (gameType === GameType.ROULETTE) {
        // 1-5 numbers, 50x-500x
        const count = randomInt(1, 5);
        const used = new Set<number>();
        for (let i = 0; i < count; i++) {
            let num;
            do { num = randomInt(0, 36); } while (used.has(num));
            used.add(num);
            const m = randomItem([50, 100, 150, 200, 250, 300, 400, 500]);
            mults.push({ id: num.toString(), multiplier: m, type: 'NUMBER', label: `${num} x${m}` });
        }
    } else if (gameType === GameType.BACCARAT) {
        // 1-3 Lightning Cards, 2x-8x
        const count = randomInt(1, 3);
        const deck = createDeck(); 
        for (let i = 0; i < count; i++) {
            const c = deck[i];
            const m = randomItem([2, 3, 4, 5, 8]);
            mults.push({ id: `${c.rank}${c.suit}`, multiplier: m, type: 'CARD', label: `${c.rank}${c.suit} x${m}` });
        }
    } else if (gameType === GameType.CRAPS) {
        // 1-2 Lucky Totals (4,5,6,8,9,10), 2x-5x
        const points = [4, 5, 6, 8, 9, 10];
        const count = randomInt(1, 2);
        const used = new Set<number>();
        for (let i = 0; i < count; i++) {
            let p;
            do { p = randomItem(points); } while (used.has(p));
            used.add(p);
            const m = randomInt(2, 5);
            mults.push({ id: p.toString(), multiplier: m, type: 'TOTAL', label: `Total ${p} x${m}` });
        }
    } else if (gameType === GameType.SIC_BO) {
        // Lightning Triple (50x)
        const triple = randomInt(1, 6);
        mults.push({ id: `TRIPLE_${triple}`, multiplier: 50, type: 'TOTAL', label: `Triple ${triple}s x50` });
        
        // Aura Number (2x-5x for matches)
        let aura;
        do { aura = randomInt(1, 6); } while (aura === triple);
        mults.push({ id: `AURA_${aura}`, multiplier: 1, type: 'NUMBER', label: `Aura ${aura}` });
    } else if (gameType === GameType.CASINO_WAR) {
        // Lightning Rank
        const r = randomItem(RANKS);
        mults.push({ id: r, multiplier: 5, type: 'RANK', label: `${r}s x5` });
    } else if (gameType === GameType.THREE_CARD) {
        // Aura Card 
        const deck = createDeck();
        const c = deck[0];
        const isWild = Math.random() < 0.05;
        mults.push({ 
            id: 'AURA_CARD', 
            multiplier: isWild ? 999 : 2, 
            type: 'CARD', 
            label: isWild ? `WILD AURA ${c.rank}${c.suit}` : `AURA ${c.rank}${c.suit}`,
            meta: c 
        });
    } else if (gameType === GameType.ULTIMATE_HOLDEM) {
        // Flop Lightning Cards (1-3)
        const deck = createDeck();
        const count = randomInt(1, 3);
        for (let i = 0; i < count; i++) {
            const c = deck[i];
            const m = randomInt(2, 5);
            mults.push({ id: `${c.rank}${c.suit}`, multiplier: m, type: 'CARD', label: `${c.rank}${c.suit} x${m}` });
        }
        // Aura Suit
        const suit = randomItem(SUITS);
        mults.push({ id: `SUIT_${suit}`, multiplier: 5, type: 'SUIT', label: `Aura ${suit}` });
    } else if (gameType === GameType.VIDEO_POKER) {
        // Wild Lightning Card
        const deck = createDeck();
        const c = deck[0];
        mults.push({ 
            id: `WILD_${c.rank}${c.suit}`, 
            multiplier: 1, 
            type: 'CARD', 
            label: `WILD ${c.rank}${c.suit}`,
            meta: c 
        });
    } else if (gameType === GameType.HILO) {
        const deck = createDeck();
        const c = deck[0];
        mults.push({ 
            id: `LIGHTNING_${c.rank}${c.suit}`, 
            multiplier: 2, 
            type: 'CARD', 
            label: `L-CARD ${c.rank}${c.suit}`, 
            meta: c 
        });
    } else if (gameType === GameType.BLACKJACK) {
        // Multipliers are persistent, handled in hook logic
    }

    return mults;
};

// --- HAND VALUES ---
export const getHandValue = (cards: Card[]): number => {
  let value = cards.reduce((acc, c) => acc + c.value, 0);
  let aces = cards.filter(c => c.rank === 'A').length;
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
};

export const getBaccaratValue = (cards: Card[]): number => {
  return cards.reduce((acc, c) => {
    let val = c.value;
    if (c.rank === '10' || c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') val = 0;
    if (c.rank === 'A') val = 1;
    return acc + val;
  }, 0) % 10;
};

export const getHiLoRank = (card: Card) => {
    if (card.rank === 'A') return 1;
    if (card.rank === 'K') return 13;
    if (card.rank === 'Q') return 12;
    if (card.rank === 'J') return 11;
    return parseInt(card.rank);
};

// Video Poker with Wild Card Support
export const evaluateVideoPokerHand = (cards: Card[], wildRank?: string, wildSuit?: string): { rank: string, multiplier: number, score: number } => {
  const wilds = cards.filter(c => 
      (wildRank && c.rank === wildRank) && (wildSuit && c.suit === wildSuit)
  );
  const nonWilds = cards.filter(c => 
      !((wildRank && c.rank === wildRank) && (wildSuit && c.suit === wildSuit))
  );
  
  const numWilds = wilds.length;

  const evaluateConcrete = (hand: Card[]) => {
      const getVal = (r: string) => {
        if (r === 'A') return 14;
        if (r === 'K') return 13;
        if (r === 'Q') return 12;
        if (r === 'J') return 11;
        return parseInt(r);
      };

      const pokerValues = hand.map(c => getVal(c.rank)).sort((a, b) => a - b);
      const suits = hand.map(c => c.suit);
      
      const isFlush = suits.every(s => s === suits[0]);
      let isStraight = true;
      for (let i = 0; i < pokerValues.length - 1; i++) {
        if (pokerValues[i+1] !== pokerValues[i] + 1) isStraight = false;
      }
      if (!isStraight && pokerValues[0] === 2 && pokerValues[1] === 3 && pokerValues[2] === 4 && pokerValues[3] === 5 && pokerValues[4] === 14) {
          isStraight = true;
      }
      
      const counts: Record<string, number> = {};
      hand.forEach(c => counts[c.rank] = (counts[c.rank] || 0) + 1);
      const countsArr = Object.values(counts).sort((a, b) => b - a);

      if (isFlush && isStraight) {
          if (pokerValues[0] === 10) return { rank: "ROYAL FLUSH", multiplier: 800, score: 9 };
          return { rank: "STRAIGHT FLUSH", multiplier: 50, score: 8 };
      }
      if (countsArr[0] === 4) return { rank: "FOUR OF A KIND", multiplier: 25, score: 7 };
      if (countsArr[0] === 3 && countsArr[1] === 2) return { rank: "FULL HOUSE", multiplier: 9, score: 6 };
      if (isFlush) return { rank: "FLUSH", multiplier: 6, score: 5 };
      if (isStraight) return { rank: "STRAIGHT", multiplier: 4, score: 4 };
      if (countsArr[0] === 3) return { rank: "THREE OF A KIND", multiplier: 3, score: 3 };
      if (countsArr[0] === 2 && countsArr[1] === 2) return { rank: "TWO PAIR", multiplier: 2, score: 2 };
      if (countsArr[0] === 2) {
          const pairRank = Object.keys(counts).find(r => counts[r] === 2);
          const val = getVal(pairRank!);
          if (val >= 11) return { rank: "JACKS OR BETTER", multiplier: 1, score: 1 };
      }
      return { rank: "HIGH CARD", multiplier: 0, score: 0 };
  };

  if (numWilds === 0) return evaluateConcrete(cards);

  let bestRes = { rank: "HIGH CARD", multiplier: 0, score: -1 };
  
  const iterateWildsFull = (idx: number, currentHand: Card[]) => {
      if (idx === numWilds) {
          const res = evaluateConcrete(currentHand);
          if (res.score > bestRes.score || (res.score === bestRes.score && res.multiplier > bestRes.multiplier)) {
              bestRes = res;
          }
          return;
      }
      const suitsToCheck: Suit[] = nonWilds.length > 0 ? [nonWilds[0].suit] : ['♠']; 
      
      for (const r of RANKS) {
          for (const s of suitsToCheck) {
             iterateWildsFull(idx + 1, [...currentHand, { rank: r, suit: s, value: 0 }]);
          }
      }
  };
  
  iterateWildsFull(0, nonWilds);
  return bestRes;
};

// Generic 5/7 Card Poker Evaluation (High Card to Royal Flush)
export const evaluatePokerHand = (cards: Card[]): { score: number, rank: string, best5: Card[] } => {
    const getVal = (r: string) => {
        if (r === 'A') return 14;
        if (r === 'K') return 13;
        if (r === 'Q') return 12;
        if (r === 'J') return 11;
        return parseInt(r);
    };

    if (cards.length > 5) {
        let bestScore = -1;
        let bestRes = null;
        
        const getCombinations = (arr: Card[], len: number): Card[][] => {
            if (len === 0) return [[]];
            if (arr.length < len) return [];
            const first = arr[0];
            const rest = arr.slice(1);
            const combsWithFirst = getCombinations(rest, len - 1).map(c => [first, ...c]);
            const combsWithoutFirst = getCombinations(rest, len);
            return [...combsWithFirst, ...combsWithoutFirst];
        };

        const combos = getCombinations(cards, 5);
        combos.forEach(hand => {
            const res = evaluatePokerHand(hand);
            if (res.score > bestScore) {
                bestScore = res.score;
                bestRes = res;
            }
        });
        return bestRes!;
    }

    const vals = cards.map(c => c.value = getVal(c.rank)).sort((a, b) => b - a); // Descending
    const suits = cards.map(c => c.suit);
    const isFlush = suits.every(s => s === suits[0]);
    
    let isStraight = true;
    for (let i = 0; i < vals.length - 1; i++) {
        if (vals[i] !== vals[i+1] + 1) isStraight = false;
    }
    // A-5 Straight
    if (!isStraight && vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2) {
        isStraight = true;
    }

    const counts: Record<number, number> = {};
    vals.forEach(v => counts[v] = (counts[v] || 0) + 1);
    
    const groups: { val: number, count: number }[] = [];
    Object.keys(counts).forEach(k => groups.push({ val: parseInt(k), count: counts[parseInt(k)] }));
    groups.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.val - a.val;
    });

    let rankStr = "HIGH CARD";
    let baseScore = 0; 

    if (isFlush && isStraight) {
        baseScore = 9;
        rankStr = vals[0] === 14 && vals[1] === 13 ? "ROYAL FLUSH" : "STRAIGHT FLUSH";
    } else if (groups[0].count === 4) {
        baseScore = 8;
        rankStr = "FOUR OF A KIND";
    } else if (groups[0].count === 3 && groups[1].count === 2) {
        baseScore = 7;
        rankStr = "FULL HOUSE";
    } else if (isFlush) {
        baseScore = 6;
        rankStr = "FLUSH";
    } else if (isStraight) {
        baseScore = 5;
        rankStr = "STRAIGHT";
    } else if (groups[0].count === 3) {
        baseScore = 4;
        rankStr = "THREE OF A KIND";
    } else if (groups[0].count === 2 && groups[1].count === 2) {
        baseScore = 3;
        rankStr = "TWO PAIR";
    } else if (groups[0].count === 2) {
        baseScore = 2;
        rankStr = "PAIR";
    } else {
        baseScore = 1;
        rankStr = "HIGH CARD";
    }

    let tieBreak = 0;
    if (baseScore === 5 || baseScore === 9) { 
        tieBreak = vals[0] === 14 && vals[4] === 2 ? 5 : vals[0]; 
    } else {
        groups.forEach((g, i) => {
            tieBreak += g.val * Math.pow(16, 4 - i);
        });
    }

    const score = (baseScore * Math.pow(16, 6)) + tieBreak;

    return { score, rank: rankStr, best5: cards };
};

export const evaluateThreeCardHand = (cards: Card[]): { score: number, rank: string, isPairPlus: boolean, pairPlusPayout: number, anteBonus: number } => {
    const getVal = (r: string) => {
        if (r === 'A') return 14;
        if (r === 'K') return 13;
        if (r === 'Q') return 12;
        if (r === 'J') return 11;
        return parseInt(r);
    };
    const vals = cards.map(c => getVal(c.rank)).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);
    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = (vals[0] === vals[1] + 1 && vals[1] === vals[2] + 1) || (vals[0] === 14 && vals[1] === 3 && vals[2] === 2);
    
    const counts: Record<number, number> = {};
    vals.forEach(v => counts[v] = (counts[v] || 0) + 1);
    const groups = Object.values(counts).sort((a, b) => b - a);

    let score = 0;
    let rank = "HIGH CARD";
    let pairPlus = 0; 
    let anteBonus = 0; 

    if (isStraight && isFlush) {
        score = 6; rank = "STRAIGHT FLUSH";
        pairPlus = 40; anteBonus = 5;
    } else if (groups[0] === 3) {
        score = 5; rank = "THREE OF A KIND";
        pairPlus = 30; anteBonus = 4;
    } else if (isStraight) {
        score = 4; rank = "STRAIGHT";
        pairPlus = 6; anteBonus = 1;
    } else if (isFlush) {
        score = 3; rank = "FLUSH";
        pairPlus = 3; 
    } else if (groups[0] === 2) {
        score = 2; rank = "PAIR";
        pairPlus = 1; 
    } else {
        score = 1; rank = "HIGH CARD";
    }

    let tieBreak = 0;
    vals.forEach((v, i) => tieBreak += v * Math.pow(16, 2-i));
    
    return { score: (score * 100000) + tieBreak, rank, isPairPlus: pairPlus > 0, pairPlusPayout: pairPlus, anteBonus };
};


export const getVisibleHandValue = (cards: Card[]) => {
    return getHandValue(cards.filter(c => !c.isHidden));
};

export const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
};

// --- ROULETTE LOGIC ---
export const getRouletteColor = (num: number): 'RED' | 'BLACK' | 'GREEN' => {
    if (num === 0) return 'GREEN';
    return RED_NUMBERS.includes(num) ? 'RED' : 'BLACK';
};

export const getRouletteColumn = (num: number): number => {
    if (num === 0) return 0;
    return (num - 1) % 3 + 1;
};

export const calculateRouletteExposure = (outcome: number, bets: RouletteBet[]) => {
    let pnl = 0;
    const color = getRouletteColor(outcome);

    bets.forEach(bet => {
        let win = 0;
        let payoutMult = 0;
        
        if (bet.type === 'STRAIGHT' && bet.target === outcome) payoutMult = 35;
        else if (bet.type === 'RED' && color === 'RED') payoutMult = 1;
        else if (bet.type === 'BLACK' && color === 'BLACK') payoutMult = 1;
        else if (bet.type === 'ODD' && outcome !== 0 && outcome % 2 !== 0) payoutMult = 1;
        else if (bet.type === 'EVEN' && outcome !== 0 && outcome % 2 === 0) payoutMult = 1;
        else if (bet.type === 'LOW' && outcome >= 1 && outcome <= 18) payoutMult = 1;
        else if (bet.type === 'HIGH' && outcome >= 19 && outcome <= 36) payoutMult = 1;
        else if (bet.type === 'ZERO' && outcome === 0) payoutMult = 35;
        
        if (payoutMult > 0) {
            win = bet.amount * payoutMult;
            pnl += win; 
        } else {
            pnl -= bet.amount;
        }
    });

    return pnl;
};

// --- CRAPS LOGIC ---
export const calculateCrapsExposure = (total: number, point: number | null, bets: CrapsBet[]) => {
    let pnl = 0;
    
    bets.forEach(bet => {
         let winAmount = 0;
         let loseAmount = 0;
         
         if (bet.type === 'PASS') {
              if (point === null) {
                  if (total === 7 || total === 11) winAmount = bet.amount;
                  else if (total === 2 || total === 3 || total === 12) loseAmount = bet.amount;
              } else {
                  if (total === point) { 
                      winAmount = bet.amount; 
                      if (bet.oddsAmount) winAmount += bet.oddsAmount * (WAYS[point]/WAYS[7]);
                  } else if (total === 7) loseAmount = bet.amount + (bet.oddsAmount || 0);
              }
         } else if (bet.type === 'DONT_PASS') {
               if (point === null) {
                   if (total === 2 || total === 3) winAmount = bet.amount;
                   else if (total === 7 || total === 11) loseAmount = bet.amount;
               } else {
                   if (total === 7) {
                       winAmount = bet.amount;
                       // Approx odds for DP? Usually 1:2 for 4/10 etc.
                       // Simplified
                       if (bet.oddsAmount) winAmount += bet.oddsAmount * 0.5; 
                   } else if (total === point) loseAmount = bet.amount + (bet.oddsAmount || 0);
               }
         } else if (bet.type === 'FIELD') {
              if ([2,12].includes(total)) winAmount = bet.amount * 2;
              else if ([3,4,9,10,11].includes(total)) winAmount = bet.amount;
              else loseAmount = bet.amount;
         } else if (bet.type === 'YES' && bet.target === total) {
              winAmount = bet.amount * 1.5; // Simplified Place Win
         } else if (bet.type === 'YES' && total === 7) {
              loseAmount = bet.amount;
         } else if (bet.type === 'NO' && total === 7) {
              winAmount = bet.amount * 0.5; // Simplified Lay Win
         } else if (bet.type === 'NO' && bet.target === total) {
              loseAmount = bet.amount;
         }

         pnl += winAmount;
         if (loseAmount > 0) pnl -= loseAmount;
    });
    return pnl;
};

/**
 * Resolves craps bets after a roll, returning pnl and remaining bets
 * Bets are resolved (removed) when they win or lose
 * PASS/DONT_PASS: resolve on 7, 11, 2, 3, 12 (come out) or point/7 (point phase)
 * FIELD: always resolves (single roll bet)
 * YES/NO: resolve when target or 7 is rolled
 */
export const resolveCrapsBets = (total: number, point: number | null, bets: CrapsBet[]): { pnl: number; remainingBets: CrapsBet[] } => {
    let pnl = 0;
    const remainingBets: CrapsBet[] = [];

    bets.forEach(bet => {
        let resolved = false;
        let winAmount = 0;
        let loseAmount = 0;

        if (bet.type === 'PASS') {
            if (point === null) {
                // Come Out Roll
                if (total === 7 || total === 11) { winAmount = bet.amount; resolved = true; }
                else if (total === 2 || total === 3 || total === 12) { loseAmount = bet.amount; resolved = true; }
                // 4,5,6,8,9,10 = point established, bet stays
            } else {
                // Point Phase
                if (total === point) {
                    winAmount = bet.amount;
                    if (bet.oddsAmount) winAmount += bet.oddsAmount * (WAYS[point]/WAYS[7]);
                    resolved = true;
                } else if (total === 7) {
                    loseAmount = bet.amount + (bet.oddsAmount || 0);
                    resolved = true;
                }
            }
        } else if (bet.type === 'DONT_PASS') {
            if (point === null) {
                if (total === 2 || total === 3) { winAmount = bet.amount; resolved = true; }
                else if (total === 7 || total === 11) { loseAmount = bet.amount; resolved = true; }
                else if (total === 12) { resolved = true; } // Push - bet returns
            } else {
                if (total === 7) {
                    winAmount = bet.amount;
                    if (bet.oddsAmount) winAmount += bet.oddsAmount * 0.5;
                    resolved = true;
                } else if (total === point) {
                    loseAmount = bet.amount + (bet.oddsAmount || 0);
                    resolved = true;
                }
            }
        } else if (bet.type === 'FIELD') {
            // Field always resolves on any roll
            if ([2, 12].includes(total)) winAmount = bet.amount * 2;
            else if ([3, 4, 9, 10, 11].includes(total)) winAmount = bet.amount;
            else loseAmount = bet.amount;
            resolved = true;
        } else if (bet.type === 'YES') {
            if (bet.target === total) { winAmount = bet.amount * 1.5; resolved = true; }
            else if (total === 7) { loseAmount = bet.amount; resolved = true; }
        } else if (bet.type === 'NO') {
            if (total === 7) { winAmount = bet.amount * 0.5; resolved = true; }
            else if (bet.target === total) { loseAmount = bet.amount; resolved = true; }
        }

        pnl += winAmount;
        if (loseAmount > 0) pnl -= loseAmount;

        if (!resolved) {
            remainingBets.push(bet);
        }
    });

    return { pnl, remainingBets };
};

export const getSicBoCombinations = () => {
    const combos = [];
    for (let i = 4; i <= 17; i++) {
        combos.push([1, 1, i-2]); // Not mathematically rigorous for all dice but sufficient for Sum check
    }
    return combos;
}

export const calculateSicBoOutcomeExposure = (combo: number[], bets: SicBoBet[]) => {
    let pnl = 0;
    const sum = combo.reduce((a,b)=>a+b,0);
    const d1 = combo[0], d2 = combo[1], d3 = combo[2];
    const isTriple = d1 === d2 && d2 === d3;

    bets.forEach(b => {
         let win = 0;
         if (b.type === 'SMALL' && sum >= 4 && sum <= 10 && !isTriple) win = b.amount;
         else if (b.type === 'BIG' && sum >= 11 && sum <= 17 && !isTriple) win = b.amount;
         else if (b.type === 'SUM' && sum === b.target) win = b.amount * 6; // Simplified
         
         if (win > 0) pnl += win;
         else pnl -= b.amount;
    });
    return pnl;
}

export const calculateHiLoProjection = (cards: Card[], deck: Card[], currentPot: number) => {
    if (cards.length === 0) return { high: 0, low: 0 };
    const current = getHiLoRank(cards[cards.length - 1]);
    let highWins = 0, lowWins = 0;
    
    deck.forEach(c => {
        const r = getHiLoRank(c);
        if (r >= current) highWins++;
        if (r <= current) lowWins++;
    });
    
    // Odds = Total / Wins
    const total = deck.length;
    return {
        high: highWins > 0 ? Math.floor(currentPot * (total / highWins) * 0.95) : 0,
        low: lowWins > 0 ? Math.floor(currentPot * (total / lowWins) * 0.95) : 0
    };
};
