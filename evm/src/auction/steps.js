function buildWeightedSteps(totalMps, steps) {
  if (totalMps <= 0) {
    throw new Error('totalMps must be > 0');
  }
  if (!steps.length) {
    throw new Error('steps required');
  }

  const weightSum = steps.reduce((sum, step) => sum + step.weight, 0);
  if (weightSum <= 0) {
    throw new Error('weights must be > 0');
  }

  let remainingMps = totalMps;
  const built = [];
  steps.forEach((step, idx) => {
    const isLast = idx === steps.length - 1;
    const stepTotalMps = isLast
      ? remainingMps
      : Math.floor((totalMps * step.weight) / weightSum);
    const mpsPerBlock = Math.max(1, Math.floor(stepTotalMps / step.blockDelta));
    built.push({ mpsPerBlock, blockDelta: step.blockDelta });
    remainingMps -= mpsPerBlock * step.blockDelta;
  });

  if (remainingMps > 0) {
    const last = built[built.length - 1];
    last.mpsPerBlock += Math.ceil(remainingMps / last.blockDelta);
  }

  return built;
}

function encodeAuctionSteps(steps) {
  const bytes = [];
  for (const step of steps) {
    const mps = step.mpsPerBlock;
    const blockDelta = step.blockDelta;
    if (mps <= 0 || mps > 0xffffff) {
      throw new Error(`invalid mpsPerBlock: ${mps}`);
    }
    if (blockDelta <= 0 || blockDelta > 0xffffffffff) {
      throw new Error(`invalid blockDelta: ${blockDelta}`);
    }
    bytes.push((mps >> 16) & 0xff, (mps >> 8) & 0xff, mps & 0xff);
    bytes.push(
      (blockDelta >> 32) & 0xff,
      (blockDelta >> 24) & 0xff,
      (blockDelta >> 16) & 0xff,
      (blockDelta >> 8) & 0xff,
      blockDelta & 0xff
    );
  }
  return '0x' + Buffer.from(bytes).toString('hex');
}

module.exports = { buildWeightedSteps, encodeAuctionSteps };
