const distributionContractAbi = [
  {
    type: 'function',
    name: 'onTokensReceived',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'auction',
    inputs: [],
    outputs: [{ name: 'auction', type: 'address' }],
    stateMutability: 'view'
  }
];

module.exports = { distributionContractAbi };
