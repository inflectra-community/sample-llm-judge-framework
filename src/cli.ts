#!/usr/bin/env node
/**
 * CLI Entry Point for the Dynamic Multi-Agent Chatbot REST API Tester.
 *
 * Parses command-line arguments and environment variables, validates configuration,
 * and invokes the Orchestrator to run the test suite.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 6.3, 6.4, 9.5
 */

import 'dotenv/config';
import { Command } from 'commander';
import { resolveConfig, ConfigurationError } from './config';
import { SteeringFileError } from './steering-loader';
import { ContractLoadError } from './contract-loader';
import { TestPlanError } from './test-plan-parser';
import { Orchestrator } from './orchestrator';

const program = new Command();

program
  .name('api-tester')
  .description('Dynamic Multi-Agent Chatbot REST API Tester')
  .version('1.0.0')
  .option('-e, --endpoint <url>', 'Target API endpoint URL (or set API_TEST_ENDPOINT in .env)')
  .option('-t, --turns <number>', 'Number of test turns (1-1000)')
  .option('--timeout <seconds>', 'Request timeout in seconds (1-300)')
  .option('-m, --mode <mode>', 'Execution mode: sequential or concurrent')
  .option('-c, --concurrency <number>', 'Concurrency limit for concurrent mode (1-100)')
  .option('--contract-path <path>', 'Path to API contract file')
  .option('--auth-token <token>', 'Bearer token for API authentication (or set API_TEST_AUTH_TOKEN in .env)')
  .option('--test-plan <path>', 'Path to test plan markdown file (or set API_TEST_PLAN in .env)')
  .option('--verbose', 'Include full input/output details for all turns in the report (not just failures)');

async function main(): Promise<void> {
  program.parse(process.argv);
  const opts = program.opts();

  // Resolve and validate configuration (CLI args override env vars)
  const config = resolveConfig({
    endpoint: opts.endpoint,
    turns: opts.turns,
    timeout: opts.timeout,
    mode: opts.mode,
    concurrency: opts.concurrency,
    contractPath: opts.contractPath,
    authToken: opts.authToken,
    testPlanPath: opts.testPlan,
    verbose: opts.verbose,
  });

  // Create and initialize the Orchestrator
  const orchestrator = new Orchestrator(config);
  await orchestrator.initialize();

  // Run the test suite
  const { exitCode, reportPath } = await orchestrator.runSuite();

  // Output report path on completion
  console.log(`Report written to: ${reportPath}`);

  process.exit(exitCode);
}

main().catch((error: unknown) => {
  if (
    error instanceof ConfigurationError ||
    error instanceof SteeringFileError ||
    error instanceof ContractLoadError ||
    error instanceof TestPlanError
  ) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  // Unexpected errors
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Unexpected error: ${message}\n`);
  process.exit(1);
});
