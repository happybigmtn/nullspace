const lbpStrategyAbi = [
  {
    type: 'function',
    name: 'migrate',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'sweepCurrency',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'sweepToken',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'migrationBlock',
    inputs: [],
    outputs: [{ name: 'blockNumber', type: 'uint64' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'sweepBlock',
    inputs: [],
    outputs: [{ name: 'blockNumber', type: 'uint64' }],
    stateMutability: 'view'
  }
];

module.exports = { lbpStrategyAbi };
