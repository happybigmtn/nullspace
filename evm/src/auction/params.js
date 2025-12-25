const { encodeAuctionSteps, buildWeightedSteps } = require('./steps');

function buildAuctionParameters(args) {
  const auctionSteps = buildWeightedSteps(args.totalMps, args.steps);
  const auctionStepsData = encodeAuctionSteps(auctionSteps);
  return {
    currency: args.currency,
    tokensRecipient: args.tokensRecipient,
    fundsRecipient: args.fundsRecipient,
    startBlock: args.startBlock,
    endBlock: args.endBlock,
    claimBlock: args.claimBlock,
    tickSpacing: args.tickSpacing,
    validationHook: args.validationHook,
    floorPrice: args.floorPrice,
    requiredCurrencyRaised: args.requiredCurrencyRaised,
    auctionStepsData
  };
}

module.exports = { buildAuctionParameters };
