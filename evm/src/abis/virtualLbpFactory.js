const virtualLbpFactoryAbi = [
  {
    type: 'function',
    name: 'initializeDistribution',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'totalSupply', type: 'uint256' },
      { name: 'configData', type: 'bytes' },
      { name: 'salt', type: 'bytes32' }
    ],
    outputs: [{ name: 'virtualLBP', type: 'address' }],
    stateMutability: 'nonpayable'
  },
  {
    type: 'event',
    name: 'DistributionInitialized',
    inputs: [
      { name: 'distributionContract', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'totalSupply', type: 'uint256', indexed: false }
    ],
    anonymous: false
  },
  {
    type: 'function',
    name: 'getVirtualLBPAddress',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'totalSupply', type: 'uint256' },
      { name: 'configData', type: 'bytes' },
      { name: 'salt', type: 'bytes32' },
      { name: 'sender', type: 'address' }
    ],
    outputs: [{ name: 'lbp', type: 'address' }],
    stateMutability: 'view'
  }
];

module.exports = { virtualLbpFactoryAbi };
