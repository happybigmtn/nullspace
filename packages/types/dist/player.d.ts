export interface Player {
    publicKey: Uint8Array;
    publicKeyHex: string;
    name: string;
    chips: bigint;
    shields: number;
    doubles: number;
    rank: number;
}
export interface PlayerBalance {
    chips: bigint;
    vusdtBalance: bigint;
    shields: number;
    doubles: number;
}
//# sourceMappingURL=player.d.ts.map