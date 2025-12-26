const feeDistributorAbi = [
  'function currency() view returns (address)',
  'function merkleRoot() view returns (bytes32)',
  'function claimDeadline() view returns (uint256)',
  'function distributionEpoch() view returns (uint256)',
  'function paused() view returns (bool)',
  'function claimed(address) view returns (uint256)',
  'function setMerkleRoot(bytes32 root,uint256 deadline,uint256 epoch)',
  'function setPaused(bool paused)',
  'function seed(uint256 amount)',
  'function claim(uint256 totalEligible,bytes32[] proof)',
  'function sweep(address recipient)',
  'event MerkleRootUpdated(bytes32 root,uint256 claimDeadline,uint256 epoch)',
  'event Seeded(address indexed from,uint256 amount)',
  'event Claimed(address indexed account,uint256 amount,uint256 totalClaimed)',
  'event Paused(bool paused)',
  'event Swept(address indexed recipient,uint256 amount)'
];

module.exports = { feeDistributorAbi };
