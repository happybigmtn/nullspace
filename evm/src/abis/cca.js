const ccaAbi = [
  {
    type: 'function',
    name: 'submitBid',
    inputs: [
      { name: 'maxPrice', type: 'uint256' },
      { name: 'amount', type: 'uint128' },
      { name: 'owner', type: 'address' },
      { name: 'prevTickPrice', type: 'uint256' },
      { name: 'hookData', type: 'bytes' }
    ],
    outputs: [{ name: 'bidId', type: 'uint256' }],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'submitBid',
    inputs: [
      { name: 'maxPrice', type: 'uint256' },
      { name: 'amount', type: 'uint128' },
      { name: 'owner', type: 'address' },
      { name: 'hookData', type: 'bytes' }
    ],
    outputs: [{ name: 'bidId', type: 'uint256' }],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'checkpoint',
    inputs: [],
    outputs: [
      {
        name: 'checkpoint',
        type: 'tuple',
        components: [
          { name: 'blockNumber', type: 'uint64' },
          { name: 'clearingPrice', type: 'uint256' },
          { name: 'cumulativeMps', type: 'uint24' }
        ]
      }
    ],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'claimTokens',
    inputs: [{ name: 'bidId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'claimTokensBatch',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'bidIds', type: 'uint256[]' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'exitBid',
    inputs: [{ name: 'bidId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'exitPartiallyFilledBid',
    inputs: [
      { name: 'bidId', type: 'uint256' },
      { name: 'lastFullyFilledCheckpointBlock', type: 'uint64' },
      { name: 'outbidBlock', type: 'uint64' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'currencyRaised',
    inputs: [],
    outputs: [{ name: 'raised', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'isGraduated',
    inputs: [],
    outputs: [{ name: 'graduated', type: 'bool' }],
    stateMutability: 'view'
  },
  {
    type: 'event',
    name: 'BidSubmitted',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'amount', type: 'uint128', indexed: false }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'TokensClaimed',
    inputs: [
      { name: 'bidId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'tokensFilled', type: 'uint256', indexed: false }
    ],
    anonymous: false
  }
];

module.exports = { ccaAbi };
