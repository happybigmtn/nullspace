/**
 * Shared bet type constants + helpers for mobile + gateway.
 * Must match execution/src/casino/* enums exactly.
 *
 * TODO: Consider moving these bet type constants to @nullspace/constants
 * The shared package currently has move opcodes but not bet type encoders.
 * Gateway-specific encoding helpers could remain here while constants migrate.
 */
// Baccarat bet types (execution/src/casino/baccarat.rs)
export const BACCARAT_BET_TYPES = {
    PLAYER: 0,
    BANKER: 1,
    TIE: 2,
    P_PAIR: 3,
    B_PAIR: 4,
    LUCKY6: 5,
    P_DRAGON: 6,
    B_DRAGON: 7,
    PANDA8: 8,
    P_PERFECT_PAIR: 9,
    B_PERFECT_PAIR: 10,
};
export function encodeBaccaratBet(type) {
    return BACCARAT_BET_TYPES[type];
}
// Craps bet types (execution/src/casino/craps.rs)
export const CRAPS_BET_TYPES = {
    PASS: 0,
    DONT_PASS: 1,
    COME: 2,
    DONT_COME: 3,
    FIELD: 4,
    YES: 5,
    NO: 6,
    NEXT: 7,
    HARDWAY: 8,
    FIRE: 12,
    ATS_SMALL: 15,
    ATS_TALL: 16,
    ATS_ALL: 17,
    MUGGSY: 18,
    DIFF_DOUBLES: 19,
    RIDE_LINE: 20,
    REPLAY: 21,
    HOT_ROLLER: 22,
};
export const CRAPS_HARDWAY_MAP = {
    4: 8,
    6: 9,
    8: 10,
    10: 11,
};
export function encodeCrapsBet(type, target) {
    let betType = CRAPS_BET_TYPES[type];
    let encodedTarget = target ?? 0;
    if (type === 'HARDWAY') {
        betType = target !== undefined ? CRAPS_HARDWAY_MAP[target] ?? betType : betType;
        encodedTarget = 0;
    }
    if (type === 'ATS_SMALL'
        || type === 'ATS_TALL'
        || type === 'ATS_ALL'
        || type === 'MUGGSY'
        || type === 'DIFF_DOUBLES'
        || type === 'RIDE_LINE'
        || type === 'REPLAY'
        || type === 'HOT_ROLLER'
        || type === 'FIRE') {
        encodedTarget = 0;
    }
    return { betType, target: encodedTarget };
}
export function crapsRequiresTarget(type) {
    return type === 'YES' || type === 'NO' || type === 'NEXT' || type === 'HARDWAY';
}
// Roulette bet types (execution/src/casino/roulette.rs)
export const ROULETTE_BET_TYPES = {
    STRAIGHT: 0,
    RED: 1,
    BLACK: 2,
    EVEN: 3,
    ODD: 4,
    LOW: 5,
    HIGH: 6,
    DOZEN: 7,
    COLUMN: 8,
    SPLIT_H: 9,
    SPLIT_V: 10,
    STREET: 11,
    CORNER: 12,
    SIX_LINE: 13,
};
export const ROULETTE_BET_NAMES = [
    'STRAIGHT',
    'RED',
    'BLACK',
    'EVEN',
    'ODD',
    'LOW',
    'HIGH',
    'DOZEN_1',
    'DOZEN_2',
    'DOZEN_3',
    'COL_1',
    'COL_2',
    'COL_3',
    'ZERO',
    'SPLIT_H',
    'SPLIT_V',
    'STREET',
    'CORNER',
    'SIX_LINE',
];
export function encodeRouletteBet(type, target) {
    switch (type) {
        case 'STRAIGHT':
            return { type: ROULETTE_BET_TYPES.STRAIGHT, value: target ?? 0 };
        case 'RED':
            return { type: ROULETTE_BET_TYPES.RED, value: 0 };
        case 'BLACK':
            return { type: ROULETTE_BET_TYPES.BLACK, value: 0 };
        case 'EVEN':
            return { type: ROULETTE_BET_TYPES.EVEN, value: 0 };
        case 'ODD':
            return { type: ROULETTE_BET_TYPES.ODD, value: 0 };
        case 'LOW':
            return { type: ROULETTE_BET_TYPES.LOW, value: 0 };
        case 'HIGH':
            return { type: ROULETTE_BET_TYPES.HIGH, value: 0 };
        case 'DOZEN_1':
            return { type: ROULETTE_BET_TYPES.DOZEN, value: 0 };
        case 'DOZEN_2':
            return { type: ROULETTE_BET_TYPES.DOZEN, value: 1 };
        case 'DOZEN_3':
            return { type: ROULETTE_BET_TYPES.DOZEN, value: 2 };
        case 'COL_1':
            return { type: ROULETTE_BET_TYPES.COLUMN, value: 0 };
        case 'COL_2':
            return { type: ROULETTE_BET_TYPES.COLUMN, value: 1 };
        case 'COL_3':
            return { type: ROULETTE_BET_TYPES.COLUMN, value: 2 };
        case 'ZERO':
            return { type: ROULETTE_BET_TYPES.STRAIGHT, value: 0 };
        case 'SPLIT_H':
            return { type: ROULETTE_BET_TYPES.SPLIT_H, value: target ?? 0 };
        case 'SPLIT_V':
            return { type: ROULETTE_BET_TYPES.SPLIT_V, value: target ?? 0 };
        case 'STREET':
            return { type: ROULETTE_BET_TYPES.STREET, value: target ?? 0 };
        case 'CORNER':
            return { type: ROULETTE_BET_TYPES.CORNER, value: target ?? 0 };
        case 'SIX_LINE':
            return { type: ROULETTE_BET_TYPES.SIX_LINE, value: target ?? 0 };
    }
}
export function rouletteRequiresTarget(type) {
    return type === 'STRAIGHT'
        || type === 'SPLIT_H'
        || type === 'SPLIT_V'
        || type === 'STREET'
        || type === 'CORNER'
        || type === 'SIX_LINE';
}
// Sic Bo bet types (execution/src/casino/sic_bo.rs)
export const SICBO_BET_TYPES = {
    SMALL: 0,
    BIG: 1,
    ODD: 2,
    EVEN: 3,
    TRIPLE_SPECIFIC: 4,
    TRIPLE_ANY: 5,
    DOUBLE_SPECIFIC: 6,
    SUM: 7,
    SINGLE_DIE: 8,
    DOMINO: 9,
    HOP3_EASY: 10,
    HOP3_HARD: 11,
    HOP4_EASY: 12,
};
export function encodeSicBoBet(type, target) {
    return {
        betType: SICBO_BET_TYPES[type],
        number: target ?? 0,
    };
}
export function sicBoRequiresTarget(type) {
    return type === 'TRIPLE_SPECIFIC'
        || type === 'DOUBLE_SPECIFIC'
        || type === 'SUM'
        || type === 'SINGLE_DIE'
        || type === 'DOMINO'
        || type === 'HOP3_EASY'
        || type === 'HOP3_HARD'
        || type === 'HOP4_EASY';
}
//# sourceMappingURL=bet-types.js.map