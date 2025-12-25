const recoveryPoolAbi = [
  {
    type: 'function',
    name: 'fund',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'totalFunded',
    inputs: [],
    outputs: [{ name: 'amount', type: 'uint256' }],
    stateMutability: 'view'
  }
];

module.exports = { recoveryPoolAbi };
