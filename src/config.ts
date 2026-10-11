/**
 * Configuration Manager for the Dynamic Multi-Agent Chatbot REST API Tester.
 *
 * Resolves configuration from CLI arguments and environment variables (CLI takes precedence).
 * Validates all values against defined ranges and throws ConfigurationError for invalid inputs.
 */

import { ResolvedConfig } from './types';

/** Error thrown when configuration validation fails. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/** Partial CLI options — all fields optional since they may come from env vars. */
export interface PartialCLIOptions {
  endpoint?: string;
  turns?: number | string;
  timeout?: number | string;
  mode?: string;
  concurrency?: number | string;
  contractPath?: string;
  authToken?: string;
  testPlanPath?: string;
  verbose?: boolean;
}

/** Default values for optional configuration parameters. */
const DEFAULTS = {
  turns: 5,
  timeout: 30,
  mode: 'sequential' as const,
  concurrency: 5,
  contractPath: './api-contract.json',
} as const;

/** Environment variable names mapped to config parameters. */
const ENV_VARS = {
  endpoint: 'API_TEST_ENDPOINT',
  turns: 'API_TEST_TURNS',
  timeout: 'API_TEST_TIMEOUT',
  mode: 'API_TEST_MODE',
  concurrency: 'API_TEST_CONCURRENCY',
  contractPath: 'API_TEST_CONTRACT',
  authToken: 'API_TEST_AUTH_TOKEN',
  testPlanPath: 'API_TEST_PLAN',
} as const;

/**
 * Resolves and validates configuration from CLI options and environment variables.
 *
 * Precedence: CLI args > environment variables > defaults.
 *
 * @param cliOptions - Partial CLI options (some may be undefined)
 * @returns Fully resolved and validated ResolvedConfig
 * @throws ConfigurationError if required params are missing or values are invalid
 */
export function resolveConfig(cliOptions: PartialCLIOptions = {}): ResolvedConfig {
  // Merge CLI args with environment variables (CLI takes precedence)
  const rawEndpoint = cliOptions.endpoint ?? process.env[ENV_VARS.endpoint];
  const rawTurns = cliOptions.turns ?? process.env[ENV_VARS.turns];
  const rawTimeout = cliOptions.timeout ?? process.env[ENV_VARS.timeout];
  const rawMode = cliOptions.mode ?? process.env[ENV_VARS.mode];
  const rawConcurrency = cliOptions.concurrency ?? process.env[ENV_VARS.concurrency];
  const rawContractPath = cliOptions.contractPath ?? process.env[ENV_VARS.contractPath];
  const rawAuthToken = cliOptions.authToken ?? process.env[ENV_VARS.authToken];
  const rawTestPlanPath = cliOptions.testPlanPath ?? process.env[ENV_VARS.testPlanPath];
  const verbose = cliOptions.verbose ?? process.env.API_TEST_VERBOSE === 'true';

  // Validate endpoint (required, must be valid HTTP(S) URL)
  const endpoint = validateEndpoint(rawEndpoint);

  // Validate turns (integer in [1, 1000], default 5)
  const turnCount = validateInteger(rawTurns, 'turns', 1, 1000, DEFAULTS.turns);

  // Validate timeout (integer in [1, 300], default 30)
  const timeoutSeconds = validateInteger(rawTimeout, 'timeout', 1, 300, DEFAULTS.timeout);

  // Validate mode ("sequential" or "concurrent", default "sequential")
  const executionMode = validateMode(rawMode);

  // Validate concurrency (integer in [1, 100], default 5)
  const concurrencyLimit = validateInteger(rawConcurrency, 'concurrency', 1, 100, DEFAULTS.concurrency);

  // Contract path (string, default ./api-contract.json)
  const contractPath = rawContractPath != null && rawContractPath !== ''
    ? String(rawContractPath)
    : DEFAULTS.contractPath;

  return {
    endpoint,
    turnCount,
    timeoutMs: timeoutSeconds * 1000,
    executionMode,
    concurrencyLimit,
    contractPath,
    authToken: rawAuthToken || undefined,
    verbose,
    steeringPaths: {
      inputAgent: '.kiro/steering/input-agent.md',
      judgeAgent: '.kiro/steering/judge-agent.md',
      testPlan: rawTestPlanPath || '.kiro/steering/test-plan.md',
    },
    outputDir: './output',
  };
}

/**
 * Validates that the endpoint is a valid HTTP or HTTPS URL.
 * @throws ConfigurationError if endpoint is missing or invalid
 */
function validateEndpoint(value: string | undefined | null): string {
  if (value == null || value === '') {
    throw new ConfigurationError(
      'Missing required configuration parameter: endpoint. Provide a valid HTTP(S) URL via --endpoint or API_TEST_ENDPOINT environment variable.'
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(
      `Invalid configuration parameter: endpoint. "${value}" is not a valid URL. Must be a valid HTTP or HTTPS URL.`
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigurationError(
      `Invalid configuration parameter: endpoint. "${value}" must use HTTP or HTTPS protocol.`
    );
  }

  return value;
}

/**
 * Validates and parses an integer configuration value within a given range.
 * @throws ConfigurationError if value is not a valid integer or outside range
 */
function validateInteger(
  value: string | number | undefined | null,
  paramName: string,
  min: number,
  max: number,
  defaultValue: number
): number {
  if (value == null || value === '') {
    return defaultValue;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ConfigurationError(
      `Invalid configuration parameter: ${paramName}. Value must be an integer in the range [${min}, ${max}].`
    );
  }

  if (parsed < min || parsed > max) {
    throw new ConfigurationError(
      `Invalid configuration parameter: ${paramName}. Value ${parsed} is outside the valid range [${min}, ${max}].`
    );
  }

  return parsed;
}

/**
 * Validates the execution mode parameter.
 * @throws ConfigurationError if mode is not "sequential" or "concurrent"
 */
function validateMode(value: string | undefined | null): 'sequential' | 'concurrent' {
  if (value == null || value === '') {
    return DEFAULTS.mode;
  }

  const normalized = value.toLowerCase();
  if (normalized !== 'sequential' && normalized !== 'concurrent') {
    throw new ConfigurationError(
      `Invalid configuration parameter: mode. Value "${value}" is not valid. Must be "sequential" or "concurrent".`
    );
  }

  return normalized;
}
