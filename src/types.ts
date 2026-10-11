/**
 * Core TypeScript interfaces and types for the Dynamic Multi-Agent Chatbot REST API Tester.
 *
 * These types define the shared data structures used across all modules:
 * CLI, Configuration, Orchestrator, Agents, API Executor, and Report Generator.
 */

// ─── CLI & Configuration ─────────────────────────────────────────────────────

/** Raw CLI options parsed from command-line arguments. */
export interface CLIOptions {
  endpoint: string;
  turns: number;
  timeout: number;
  mode: 'sequential' | 'concurrent';
  concurrency: number;
  contractPath: string;
}

/** Fully resolved and validated configuration used by the Orchestrator. */
export interface ResolvedConfig {
  endpoint: string;
  turnCount: number;
  timeoutMs: number;
  executionMode: 'sequential' | 'concurrent';
  concurrencyLimit: number;
  contractPath: string;
  authToken?: string;
  verbose: boolean;
  steeringPaths: {
    inputAgent: string;
    judgeAgent: string;
    testPlan: string;
  };
  outputDir: string;
}

// ─── Input Generation ────────────────────────────────────────────────────────

/** The four input profile categories for test payload generation. */
export type InputProfile =
  | 'happy_path'
  | 'boundary_values'
  | 'malicious_content'
  | 'structural_anomalies';

/** A generated test input produced by the Input Generator agent. */
export interface GeneratedInput {
  payload: unknown;
  profile: InputProfile;
  contentType: string;
  metadata: {
    description: string;
  };
}

// ─── API Execution ───────────────────────────────────────────────────────────

/** Captured HTTP response from the Target API, including error information. */
export interface APIResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  latencyMs: number;
  error?: {
    type: 'timeout' | 'connection_refused' | 'dns_failure' | 'tls_failure' | 'unknown';
    message: string;
  };
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

/** Failure category assigned by the Judge Evaluator. */
export type FailureCategory =
  | 'NONE'
  | 'SCHEMA_VIOLATION'
  | 'UNHANDLED_EXCEPTION'
  | 'LOGIC_ERROR'
  | 'SECURITY_RISK'
  | 'PERFORMANCE_ISSUE';

/** A single assertion within a Verdict. */
export interface Assertion {
  check: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

/** Structured evaluation verdict produced by the Judge Evaluator agent. */
export interface Verdict {
  testId: string;
  verdict: 'PASSED' | 'FAILED';
  confidenceScore: number;
  failureCategory: FailureCategory;
  summary: string;
  assertions: Assertion[];
}

// ─── Test Turn Results ───────────────────────────────────────────────────────

/** Status of an individual test turn after execution. */
export type TurnStatus =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'execution_error'
  | 'evaluation_error';

/** Error details for a failed test turn phase. */
export interface TurnError {
  phase: 'input_generation' | 'api_execution' | 'evaluation';
  type: string;
  message: string;
}

/** Complete result of a single test turn including all phase outputs. */
export interface TestTurnResult {
  turnId: string;
  turnIndex: number;
  status: TurnStatus;
  profile: InputProfile;
  input?: GeneratedInput;
  response?: APIResponse;
  verdict?: Verdict;
  error?: TurnError;
  timestamps: {
    inputGenStart?: Date;
    inputGenEnd?: Date;
    apiCallStart?: Date;
    apiCallEnd?: Date;
    evaluationStart?: Date;
    evaluationEnd?: Date;
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

/** Aggregated result of a complete test suite run. */
export interface TestSuiteResult {
  turns: TestTurnResult[];
  startTime: Date;
  endTime: Date;
  config: ResolvedConfig;
}

// ─── Profile Allocation ──────────────────────────────────────────────────────

/** Pre-computed profile assignment for a single turn. */
export interface ProfileAllocation {
  turnIndex: number;
  profile: InputProfile;
  isScenarioStep: boolean;
  scenarioContext?: string;
}

/** Distribution percentages for each input profile (must sum to 100). */
export interface ProfileDistribution {
  happy_path: number;
  boundary_values: number;
  malicious_content: number;
  structural_anomalies: number;
}

// ─── Test Plan ───────────────────────────────────────────────────────────────

/** A single step in a scenario sequence. */
export interface ScenarioStep {
  profile: InputProfile;
  description: string;
  context?: string;
}

/** Parsed test plan containing distribution, scenarios, and thresholds. */
export interface TestPlan {
  profileDistribution: ProfileDistribution;
  scenarioSequences: ScenarioStep[];
  priorityAreas: string[];
  passThreshold: number;
  specialInstructions: string;
}

// ─── API Contract ────────────────────────────────────────────────────────────

/** Definition of a single field in a request or response schema. */
export interface FieldDefinition {
  name: string;
  type: string;
  required: boolean;
  constraints?: Record<string, unknown>;
}

/** Schema definition for API requests. */
export interface RequestSchema {
  requiredFields: FieldDefinition[];
  requiredHeaders: Record<string, string>;
  contentType: string;
}

/** Schema definition for API responses. */
export interface ResponseSchema {
  successStatusCodes: number[];
  errorStatusCodes: number[];
  bodyStructure: FieldDefinition[];
  errorFormat: FieldDefinition[];
}

/** Parsed and validated API contract. */
export interface APIContract {
  format: 'openapi' | 'jsonschema';
  raw: object;
  endpointPath: string;
  requestSchema: RequestSchema;
  responseSchema: ResponseSchema;
}
