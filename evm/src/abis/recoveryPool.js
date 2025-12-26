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
    name: 'repay',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'sweep',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'totalFunded',
    inputs: [],
    outputs: [{ name: 'amount', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'totalRepaid',
    inputs: [],
    outputs: [{ name: 'amount', type: 'uint256' }],
    stateMutability: 'view'
  }
];

module.exports = { recoveryPoolAbi };
