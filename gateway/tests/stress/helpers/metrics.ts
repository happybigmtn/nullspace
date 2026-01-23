/**
 * Metrics Collector for Casino Stress Testing
 *
 * Collects, aggregates, and reports test metrics including:
 * - Latency percentiles (P50, P95, P99)
 * - Success/failure rates
 * - Game-specific statistics
 * - Balance tracking
 */

export interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number;
}

export interface GameStats {
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  errors: number;
  totalWagered: bigint;
  totalPayout: bigint;
  netProfit: bigint;
  latencies: number[];
}

export interface TestMetrics {
  startTime: Date;
  endTime?: Date;
  duration?: number;
  totalBetsPlaced: number;
  totalBetsResolved: number;
  successRate: number;
  games: Map<string, GameStats>;
  errors: string[];
  chainMetrics?: ChainMetrics;
}

export interface ChainMetrics {
  startHeight: number;
  endHeight: number;
  blocksAdvanced: number;
  avgBlockTime: number;
}

export interface ReportOptions {
  includeErrors?: boolean;
  maxErrors?: number;
  includeLatencyHistogram?: boolean;
}

/**
 * Metrics collector singleton
 */
export class MetricsCollector {
  private metrics: TestMetrics;
  private gameStats: Map<string, GameStats>;

  constructor() {
    this.gameStats = new Map();
    this.metrics = {
      startTime: new Date(),
      totalBetsPlaced: 0,
      totalBetsResolved: 0,
      successRate: 0,
      games: this.gameStats,
      errors: [],
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.gameStats = new Map();
    this.metrics = {
      startTime: new Date(),
      totalBetsPlaced: 0,
      totalBetsResolved: 0,
      successRate: 0,
      games: this.gameStats,
      errors: [],
    };
  }

  /**
   * Record a bet placement
   */
  recordBetPlaced(game: string, amount: bigint): void {
    this.metrics.totalBetsPlaced++;

    const stats = this.getOrCreateGameStats(game);
    stats.totalBets++;
    stats.totalWagered += amount;
  }

  /**
   * Record a bet resolution
   */
  recordBetResolved(
    game: string,
    result: { won: boolean; payout: bigint; latencyMs: number; push?: boolean }
  ): void {
    this.metrics.totalBetsResolved++;

    const stats = this.getOrCreateGameStats(game);

    if (result.push) {
      stats.pushes++;
    } else if (result.won) {
      stats.wins++;
    } else {
      stats.losses++;
    }

    stats.totalPayout += result.payout;
    stats.latencies.push(result.latencyMs);
    stats.netProfit = stats.totalPayout - stats.totalWagered;

    this.updateSuccessRate();
  }

  /**
   * Record an error
   */
  recordError(game: string, error: string): void {
    const stats = this.getOrCreateGameStats(game);
    stats.errors++;

    // Keep limited error log
    if (this.metrics.errors.length < 100) {
      this.metrics.errors.push(`[${game}] ${error}`);
    }
  }

  /**
   * Record chain metrics
   */
  recordChainMetrics(startHeight: number, endHeight: number, durationMs: number): void {
    const blocksAdvanced = endHeight - startHeight;
    this.metrics.chainMetrics = {
      startHeight,
      endHeight,
      blocksAdvanced,
      avgBlockTime: blocksAdvanced > 0 ? durationMs / blocksAdvanced : 0,
    };
  }

  /**
   * Finalize metrics
   */
  finalize(): TestMetrics {
    this.metrics.endTime = new Date();
    this.metrics.duration = this.metrics.endTime.getTime() - this.metrics.startTime.getTime();
    this.updateSuccessRate();
    return this.metrics;
  }

  /**
   * Get latency statistics for a game
   */
  getLatencyStats(game: string): LatencyStats | null {
    const stats = this.gameStats.get(game);
    if (!stats || stats.latencies.length === 0) {
      return null;
    }

    return this.calculateLatencyStats(stats.latencies);
  }

  /**
   * Get aggregate latency statistics across all games
   */
  getAggregateLatencyStats(): LatencyStats {
    const allLatencies: number[] = [];
    for (const stats of this.gameStats.values()) {
      allLatencies.push(...stats.latencies);
    }

    if (allLatencies.length === 0) {
      return {
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        samples: 0,
      };
    }

    return this.calculateLatencyStats(allLatencies);
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): TestMetrics {
    return this.metrics;
  }

  /**
   * Generate a human-readable report
   */
  generateReport(options: ReportOptions = {}): string {
    const { includeErrors = true, maxErrors = 10, includeLatencyHistogram = false } = options;

    this.finalize();

    const lines: string[] = [];
    lines.push('='.repeat(60));
    lines.push('CASINO STRESS TEST REPORT');
    lines.push('='.repeat(60));
    lines.push('');

    // Summary
    lines.push('SUMMARY');
    lines.push('-'.repeat(40));
    lines.push(`Duration: ${formatDuration(this.metrics.duration ?? 0)}`);
    lines.push(`Total Bets Placed: ${this.metrics.totalBetsPlaced}`);
    lines.push(`Total Bets Resolved: ${this.metrics.totalBetsResolved}`);
    lines.push(`Success Rate: ${(this.metrics.successRate * 100).toFixed(2)}%`);
    lines.push('');

    // Latency
    const latencyStats = this.getAggregateLatencyStats();
    lines.push('LATENCY');
    lines.push('-'.repeat(40));
    lines.push(`Samples: ${latencyStats.samples}`);
    lines.push(`Min: ${latencyStats.min.toFixed(1)}ms`);
    lines.push(`Max: ${latencyStats.max.toFixed(1)}ms`);
    lines.push(`Avg: ${latencyStats.avg.toFixed(1)}ms`);
    lines.push(`P50: ${latencyStats.p50.toFixed(1)}ms`);
    lines.push(`P95: ${latencyStats.p95.toFixed(1)}ms`);
    lines.push(`P99: ${latencyStats.p99.toFixed(1)}ms`);
    lines.push('');

    // Per-game stats
    lines.push('GAME STATISTICS');
    lines.push('-'.repeat(40));

    for (const [game, stats] of this.gameStats) {
      const winRate =
        stats.totalBets > 0
          ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
          : '0.0';
      const gameLatency = this.getLatencyStats(game);

      lines.push(`\n${game.toUpperCase()}`);
      lines.push(`  Bets: ${stats.totalBets}`);
      lines.push(`  Wins: ${stats.wins} | Losses: ${stats.losses} | Pushes: ${stats.pushes}`);
      lines.push(`  Win Rate: ${winRate}%`);
      lines.push(`  Wagered: ${stats.totalWagered.toString()}`);
      lines.push(`  Payout: ${stats.totalPayout.toString()}`);
      lines.push(`  Net: ${stats.netProfit.toString()}`);
      lines.push(`  Errors: ${stats.errors}`);
      if (gameLatency) {
        lines.push(
          `  Latency: P50=${gameLatency.p50.toFixed(0)}ms, P99=${gameLatency.p99.toFixed(0)}ms`
        );
      }
    }
    lines.push('');

    // Chain metrics
    if (this.metrics.chainMetrics) {
      lines.push('CHAIN METRICS');
      lines.push('-'.repeat(40));
      lines.push(`Start Height: ${this.metrics.chainMetrics.startHeight}`);
      lines.push(`End Height: ${this.metrics.chainMetrics.endHeight}`);
      lines.push(`Blocks Advanced: ${this.metrics.chainMetrics.blocksAdvanced}`);
      lines.push(`Avg Block Time: ${this.metrics.chainMetrics.avgBlockTime.toFixed(0)}ms`);
      lines.push('');
    }

    // Errors
    if (includeErrors && this.metrics.errors.length > 0) {
      lines.push('ERRORS');
      lines.push('-'.repeat(40));
      const errorsToShow = this.metrics.errors.slice(0, maxErrors);
      for (const err of errorsToShow) {
        lines.push(`  ${err}`);
      }
      if (this.metrics.errors.length > maxErrors) {
        lines.push(`  ... and ${this.metrics.errors.length - maxErrors} more`);
      }
      lines.push('');
    }

    // Latency histogram
    if (includeLatencyHistogram && latencyStats.samples > 0) {
      lines.push('LATENCY HISTOGRAM');
      lines.push('-'.repeat(40));
      const allLatencies: number[] = [];
      for (const stats of this.gameStats.values()) {
        allLatencies.push(...stats.latencies);
      }
      lines.push(this.generateHistogram(allLatencies));
      lines.push('');
    }

    lines.push('='.repeat(60));
    return lines.join('\n');
  }

  /**
   * Export metrics as JSON
   */
  toJSON(): object {
    this.finalize();

    const gamesObj: Record<string, object> = {};
    for (const [game, stats] of this.gameStats) {
      gamesObj[game] = {
        totalBets: stats.totalBets,
        wins: stats.wins,
        losses: stats.losses,
        pushes: stats.pushes,
        errors: stats.errors,
        totalWagered: stats.totalWagered.toString(),
        totalPayout: stats.totalPayout.toString(),
        netProfit: stats.netProfit.toString(),
        latency: this.getLatencyStats(game),
      };
    }

    return {
      startTime: this.metrics.startTime.toISOString(),
      endTime: this.metrics.endTime?.toISOString(),
      durationMs: this.metrics.duration,
      totalBetsPlaced: this.metrics.totalBetsPlaced,
      totalBetsResolved: this.metrics.totalBetsResolved,
      successRate: this.metrics.successRate,
      aggregateLatency: this.getAggregateLatencyStats(),
      games: gamesObj,
      chainMetrics: this.metrics.chainMetrics,
      errors: this.metrics.errors.slice(0, 100),
    };
  }

  private getOrCreateGameStats(game: string): GameStats {
    let stats = this.gameStats.get(game);
    if (!stats) {
      stats = {
        totalBets: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        errors: 0,
        totalWagered: 0n,
        totalPayout: 0n,
        netProfit: 0n,
        latencies: [],
      };
      this.gameStats.set(game, stats);
    }
    return stats;
  }

  private updateSuccessRate(): void {
    if (this.metrics.totalBetsPlaced === 0) {
      this.metrics.successRate = 0;
      return;
    }
    this.metrics.successRate = this.metrics.totalBetsResolved / this.metrics.totalBetsPlaced;
  }

  private calculateLatencyStats(latencies: number[]): LatencyStats {
    if (latencies.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, samples: 0 };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      samples: sorted.length,
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private generateHistogram(latencies: number[]): string {
    if (latencies.length === 0) return '  No data';

    const buckets = [0, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000];
    const counts: number[] = Array(buckets.length + 1).fill(0);

    for (const lat of latencies) {
      let placed = false;
      for (let i = 0; i < buckets.length; i++) {
        if (lat < buckets[i]) {
          counts[i]++;
          placed = true;
          break;
        }
      }
      if (!placed) {
        counts[buckets.length]++;
      }
    }

    const lines: string[] = [];
    const maxCount = Math.max(...counts);
    const barWidth = 40;

    for (let i = 0; i <= buckets.length; i++) {
      const label =
        i === 0
          ? `  <${buckets[0]}ms`
          : i === buckets.length
            ? `  >${buckets[buckets.length - 1]}ms`
            : `  <${buckets[i]}ms`;

      const barLength = maxCount > 0 ? Math.round((counts[i] / maxCount) * barWidth) : 0;
      const bar = '#'.repeat(barLength);
      const count = counts[i].toString().padStart(6);

      lines.push(`${label.padEnd(12)} ${count} |${bar}`);
    }

    return lines.join('\n');
  }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

/**
 * Create a shared metrics instance
 */
export const globalMetrics = new MetricsCollector();

/**
 * Convenience function to create a new metrics collector
 */
export function createMetricsCollector(): MetricsCollector {
  return new MetricsCollector();
}
