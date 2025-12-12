export const transformSupplyData = (data) => {
  return data.map(d => ({
    ...d,
    circulating: 1_000_000_000 + (d.total_issuance || 0) - d.total_burned,
    issuance: d.total_issuance || 0,
    burned: d.total_burned,
    net: (d.total_issuance || 0) - d.total_burned
  }));
};

export const transformIssuanceData = (data) => {
  return data.map((d, i) => {
    if (i === 0) return { ...d, rate_mint: 0, rate_burn: 0, net_rate: 0 };
    const prev = data[i - 1];
    const dt = (d.timestamp - prev.timestamp) || 1; 
    
    const mintDelta = (d.total_issuance || 0) - (prev.total_issuance || 0);
    const burnDelta = d.total_burned - prev.total_burned;
    
    return {
      ...d,
      rate_mint: mintDelta / dt,
      rate_burn: -(burnDelta / dt),
      net_rate: (mintDelta - burnDelta) / dt
    };
  }).slice(1);
};

export const transformPoolHealthData = (data) => {
  return data.map(d => ({
    timestamp: d.timestamp,
    tvl: d.pool_tvl_vusdt || 0,
    lp_price: d.lp_share_price_vusdt || 0,
    invariant_k: Number(d.amm_invariant_k || 0),
    price: d.rng_price || 0,
  }));
};

export const transformRoleVolumes = (data) => {
  let cumWhale = 0;
  let cumRetail = 0;
  let cumOther = 0;
  return data.map(d => {
    cumWhale += d.whale_volume_vusdt || 0;
    cumRetail += d.retail_volume_vusdt || 0;
    const swapVol = d.volume_vusdt || 0;
    const otherVol = Math.max(0, swapVol - (d.whale_volume_vusdt || 0) - (d.retail_volume_vusdt || 0));
    cumOther += otherVol;
    return {
      timestamp: d.timestamp,
      whale: cumWhale,
      retail: cumRetail,
      other: cumOther,
      grinder_joins: d.grinder_tournament_joins || 0,
      maximizer_bets: d.maximizer_game_bet_volume || 0,
    };
  });
};

export const transformErrorSeries = (data) => {
  return data.map(d => ({
    timestamp: d.timestamp,
    invalid: d.errors_invalid_move || 0,
    invalid_bet: d.errors_invalid_bet || 0,
    insufficient: d.errors_insufficient || 0,
    player_not_found: d.errors_player_not_found || 0,
    session_exists: d.errors_session_exists || 0,
    session_not_found: d.errors_session_not_found || 0,
    session_not_owned: d.errors_session_not_owned || 0,
    session_complete: d.errors_session_complete || 0,
    tournament_not_registering: d.errors_tournament_not_registering || 0,
    already_in_tournament: d.errors_already_in_tournament || 0,
    tournament_limit: d.errors_tournament_limit_reached || 0,
    rate_limited: d.errors_rate_limited || 0,
    other: d.errors_other || 0,
  }));
};

export const transformCollateralSeries = (data) => {
  let collateral = 0;
  let debt = 0;
  return data.map(d => {
    collateral += d.vault_collateral || 0;
    debt += (d.vusd_borrowed || 0) - (d.vusd_repaid || 0);
    const price = d.rng_price || 0;
    const collateral_vusd = collateral * price;
    const ltv = collateral_vusd > 0 ? (debt / collateral_vusd) : 0;
    return {
      timestamp: d.timestamp,
      collateral,
      debt,
      collateral_vusd,
      ltv,
    };
  });
};
