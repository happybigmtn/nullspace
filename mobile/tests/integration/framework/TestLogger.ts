/**
 * Test Logger - Detailed logging for mobile integration tests
 * Provides structured logging with timestamps, test context, and log levels
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS',
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  testName: string;
  message: string;
  data?: unknown;
}

export class TestLogger {
  private logs: LogEntry[] = [];
  private testName: string;
  private startTime: number;

  constructor(testName: string) {
    this.testName = testName;
    this.startTime = Date.now();
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      testName: this.testName,
      message,
      data,
    };

    this.logs.push(entry);

    // Format for console output
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const prefix = `[${elapsed}s] [${level}] [${this.testName}]`;
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';

    const colors = {
      DEBUG: '\x1b[90m', // Gray
      INFO: '\x1b[36m', // Cyan
      WARN: '\x1b[33m', // Yellow
      ERROR: '\x1b[31m', // Red
      SUCCESS: '\x1b[32m', // Green
    };
    const reset = '\x1b[0m';

    console.log(`${colors[level]}${prefix}${reset} ${message}${dataStr}`);
  }

  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data);
  }

  success(message: string, data?: unknown): void {
    this.log(LogLevel.SUCCESS, message, data);
  }

  /**
   * Get all logs for this test
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Export logs to JSON file
   */
  exportLogs(filepath: string): void {
    const fs = require('fs');
    const countByLevel = (level: LogLevel) => this.getLogsByLevel(level).length;
    const data = {
      testName: this.testName,
      duration: Date.now() - this.startTime,
      logs: this.logs,
      summary: {
        total: this.logs.length,
        debug: countByLevel(LogLevel.DEBUG),
        info: countByLevel(LogLevel.INFO),
        warn: countByLevel(LogLevel.WARN),
        error: countByLevel(LogLevel.ERROR),
        success: countByLevel(LogLevel.SUCCESS),
      },
    };

    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    this.info(`Logs exported to ${filepath}`);
  }

  /**
   * Print summary of test execution
   */
  printSummary(): void {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const errors = this.getLogsByLevel(LogLevel.ERROR).length;
    const warnings = this.getLogsByLevel(LogLevel.WARN).length;
    const successes = this.getLogsByLevel(LogLevel.SUCCESS).length;

    console.log('\n' + '='.repeat(80));
    console.log(`Test Summary: ${this.testName}`);
    console.log('='.repeat(80));
    console.log(`Duration: ${duration}s`);
    console.log(`Total Logs: ${this.logs.length}`);
    console.log(`✓ Successes: ${successes}`);
    console.log(`⚠ Warnings: ${warnings}`);
    console.log(`✗ Errors: ${errors}`);
    console.log('='.repeat(80) + '\n');
  }
}
