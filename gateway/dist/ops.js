const opsBase = (process.env.OPS_ANALYTICS_URL ?? process.env.OPS_URL ?? '').trim().replace(/\/$/, '');
const opsEventsUrl = opsBase.endsWith('/analytics/events')
    ? opsBase
    : opsBase
        ? `${opsBase}/analytics/events`
        : '';
const hasOps = () => Boolean(opsEventsUrl);
const sendOpsEvent = async (name, props, session) => {
    if (!opsEventsUrl)
        return;
    try {
        await fetch(opsEventsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                events: [{ ts: Date.now(), name, props }],
                actor: session?.publicKeyHex ? { publicKey: session.publicKeyHex } : undefined,
                source: { app: 'gateway', env: process.env.NODE_ENV },
                session: session?.id ? { id: session.id } : undefined,
            }),
        });
    }
    catch {
        // ignore ops analytics failures
    }
};
export const trackGatewayResponse = (session, response) => {
    if (!hasOps() || !response)
        return;
    const type = response.type;
    if (!type)
        return;
    if (type === 'game_started') {
        void sendOpsEvent('casino.game.started', {
            source: 'gateway',
            gameType: response.gameType,
            bet: response.bet ? Number(response.bet) : undefined,
            sessionId: response.sessionId,
        }, session);
        return;
    }
    if (type === 'game_result') {
        const finalChips = response.finalChips ?? response.balance;
        const finalNum = finalChips !== undefined ? Number(finalChips) : undefined;
        const startNum = session?.lastGameStartChips !== undefined
            ? Number(session.lastGameStartChips)
            : undefined;
        const netPnL = finalNum !== undefined && startNum !== undefined
            ? finalNum - startNum
            : undefined;
        const wager = session?.lastGameBet !== undefined
            ? Number(session.lastGameBet)
            : response.bet
                ? Number(response.bet)
                : undefined;
        void sendOpsEvent('casino.game.completed', {
            source: 'gateway',
            gameType: response.gameType,
            sessionId: response.sessionId,
            wager,
            netPnL,
            payout: response.payout ? Number(response.payout) : undefined,
            finalChips: finalNum,
            mode: 'CASH',
        }, session);
        return;
    }
};
export const trackGatewaySession = (session) => {
    if (!session || !hasOps())
        return;
    void sendOpsEvent('casino.session.started', {
        source: 'gateway',
    }, session);
};
export const trackGatewayFaucet = (session, amount) => {
    if (!session || !hasOps())
        return;
    void sendOpsEvent('casino.faucet.claimed', {
        source: 'gateway',
        amount: Number(amount),
    }, session);
};
//# sourceMappingURL=ops.js.map