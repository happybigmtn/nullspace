export function formatApproxTimeFromBlocks(blocks: number, secondsPerBlock = 3): string {
  if (!Number.isFinite(blocks) || blocks <= 0) return '0s';
  const totalSeconds = Math.floor(blocks * secondsPerBlock);
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `~${days}d`;
  if (hours > 0) return `~${hours}h`;
  if (minutes > 0) return `~${minutes}m`;
  return `~${totalSeconds}s`;
}
