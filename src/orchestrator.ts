/**
 * Orchestrator module for the Dynamic Multi-Agent Chatbot REST API Tester.
 *
 * Central coordination engine that manages the test lifecycle:
 * - Loads steering files, API contract, and test plan
 * - Pre-computes profile allocations
 * - Spawns Input Generator and Judge Evaluator agents
 * - Executes test turns (sequential or concurrent)
 * - Implements error isolation per turn
 * - Aggregates results and generates report
 *
 * Requirements: 1.1, 1.4, 2.2, 3.1, 4.1, 7.1, 7.2, 8.1, 8.2, 8.3, 9.3, 9.4, 9.5, 9.8
 */

import {
  ResolvedConfig,
  TestSuiteResult,
  TestTurnResult,
  TurnStatus,
  TurnError,
  ProfileAllocation,
  TestPlan,
  APIContract,
  GeneratedInput,
  APIResponse,
} from './types';
import { loadSteeringFile } from './steering-loader';
import { loadContract } from './contract-loader';
import { parseTestPlan } from './test-plan-parser';
import { allocateProfiles } from './profile-allocator';
import { executeRequest } from './api-executor';
import { InputGeneratorAgent } from './agents/input-generator';
import { JudgeEvaluatorAgent } from './agents/judge-evaluator';
import { generateReport, writeReport } from './report-generator';
import { createLLMProvider } from './llm-provider';

/**
 * Orchestrator class that coordinates the full test suite lifecycle.
 */
export class Orchestrator {
  private readonly config: ResolvedConfig;
  private inputAgentSteering: string = '';
  private judgeAgentSteering: string = '';
  private contract!: APIContract;
  private testPlan!: TestPlan;
  private allocations: ProfileAllocation[] = [];
  private inputGenerator!: InputGeneratorAgent;
  private judgeEvaluator!: JudgeEvaluatorAgent;

  constructor(config: ResolvedConfig) {
    this.config = config;
  }

  /**
   * Initializes the Orchestrator by loading all required resources:
   * - Steering files (input-agent.md, judge-agent.md)
   * - API contract
   * - Test plan (with fallback to defaults)
   * - Profile allocations
   * - Agent instances
   */
  async initialize(): Promise<void> {
    // Load steering files
    this.inputAgentSteering = await loadSteeringFile(this.config.steeringPaths.inputAgent);
    this.judgeAgentSteering = await loadSteeringFile(this.config.steeringPaths.judgeAgent);

    // Load API contract
    this.contract = await loadContract(this.config.contractPath);

    // Parse test plan
    this.testPlan = await parseTestPlan(
      this.config.steeringPaths.testPlan,
      this.config.turnCount
    );

    // Compute profile allocations
    this.allocations = allocateProfiles(
      this.config.turnCount,
      this.testPlan.profileDistribution,
      this.testPlan.scenarioSequences
    );

    // Build test plan context for the Input Generator (priority areas + special instructions)
    const testPlanContext = this.buildTestPlanContext();

    // Create agent instances
    this.inputGenerator = new InputGeneratorAgent(
      this.inputAgentSteering,
      this.contract,
      testPlanContext
    );

    this.judgeEvaluator = new JudgeEvaluatorAgent(
      this.judgeAgentSteering,
      this.contract
    );

    // Wire up LLM provider if credentials are available (OpenAI or Bedrock)
    const llmProvider = createLLMProvider();
    if (llmProvider) {
      this.inputGenerator.setLLMProvider(llmProvider);
      this.judgeEvaluator.setLLMProvider(llmProvider);
    }
  }

  /**
   * Executes the full test suite lifecycle.
   *
   * For each turn: generate input → call API → evaluate → record.
   * Supports sequential and concurrent execution modes.
   * Implements error isolation: per-turn errors are caught and recorded
   * without halting the suite.
   *
   * @returns Object containing the suite result, exit code, and report file path
   */
  async runSuite(): Promise<{ result: TestSuiteResult; exitCode: number; reportPath: string }> {
    const startTime = new Date();
    let turns: TestTurnResult[];

    if (this.config.executionMode === 'concurrent') {
      turns = await this.runConcurrent();
    } else {
      turns = await this.runSequential();
    }

    const endTime = new Date();

    const suiteResult: TestSuiteResult = {
      turns,
      startTime,
      endTime,
      config: this.config,
    };

    // Generate and write report
    const report = generateReport(suiteResult, this.testPlan, this.config.verbose);
    const reportPath = writeReport(report, this.config.outputDir, startTime);

    // Calculate exit code based on pass rate vs threshold
    const exitCode = this.calculateExitCode(turns);

    return { result: suiteResult, exitCode, reportPath };
  }

  /**
   * Executes turns sequentially (one at a time).
   */
  private async runSequential(): Promise<TestTurnResult[]> {
    const results: TestTurnResult[] = [];

    for (let i = 0; i < this.allocations.length; i++) {
      const result = await this.executeTurn(i);
      results.push(result);
    }

    return results;
  }

  /**
   * Executes turns concurrently in batches up to the concurrency limit.
   * Each turn still follows the generate→call→evaluate pipeline sequentially
   * within itself, but multiple turns run in parallel.
   */
  private async runConcurrent(): Promise<TestTurnResult[]> {
    const results: TestTurnResult[] = new Array(this.allocations.length);
    const limit = this.config.concurrencyLimit;

    for (let batchStart = 0; batchStart < this.allocations.length; batchStart += limit) {
      const batchEnd = Math.min(batchStart + limit, this.allocations.length);
      const batchPromises: Promise<TestTurnResult>[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        batchPromises.push(this.executeTurn(i));
      }

      const batchResults = await Promise.all(batchPromises);
      for (let j = 0; j < batchResults.length; j++) {
        results[batchStart + j] = batchResults[j];
      }
    }

    return results;
  }

  /**
   * Executes a single test turn with error isolation at each phase boundary.
   *
   * Phases:
   * 1. Input generation (error → "skipped")
   * 2. API execution (error → "execution_error")
   * 3. Evaluation (error → "evaluation_error")
   */
  private async executeTurn(turnIndex: number): Promise<TestTurnResult> {
    const allocation = this.allocations[turnIndex];
    const turnId = `turn-${String(turnIndex + 1).padStart(3, '0')}`;
    const profile = allocation.profile;

    const timestamps: TestTurnResult['timestamps'] = {};

    // Phase 1: Generate input
    let input: GeneratedInput | undefined;
    timestamps.inputGenStart = new Date();
    try {
      input = await this.inputGenerator.generatePayload(profile, turnIndex, allocation.scenarioContext);
      timestamps.inputGenEnd = new Date();

      // Check if the generator returned an error indication (null payload)
      if (input.payload === null && input.metadata.description.startsWith('[ERROR]')) {
        const turnError: TurnError = {
          phase: 'input_generation',
          type: 'llm_error',
          message: input.metadata.description,
        };
        this.logError(turnId, turnError);
        return {
          turnId,
          turnIndex,
          status: 'skipped',
          profile,
          input,
          error: turnError,
          timestamps,
        };
      }
    } catch (error: unknown) {
      timestamps.inputGenEnd = new Date();
      const turnError = this.buildTurnError('input_generation', error);
      this.logError(turnId, turnError);
      return {
        turnId,
        turnIndex,
        status: 'skipped',
        profile,
        error: turnError,
        timestamps,
      };
    }

    // Phase 2: Execute API call
    let response: APIResponse | undefined;
    timestamps.apiCallStart = new Date();
    try {
      response = await executeRequest(input, this.config.endpoint, this.config.timeoutMs, this.config.authToken, this.contract.endpointPath);
      timestamps.apiCallEnd = new Date();

      // If the API executor returned an error object, treat it as an execution error
      if (response.error) {
        const turnError: TurnError = {
          phase: 'api_execution',
          type: response.error.type,
          message: response.error.message,
        };
        this.logError(turnId, turnError);
        return {
          turnId,
          turnIndex,
          status: 'execution_error',
          profile,
          input,
          response,
          error: turnError,
          timestamps,
        };
      }
    } catch (error: unknown) {
      timestamps.apiCallEnd = new Date();
      const turnError = this.buildTurnError('api_execution', error);
      this.logError(turnId, turnError);
      return {
        turnId,
        turnIndex,
        status: 'execution_error',
        profile,
        input,
        error: turnError,
        timestamps,
      };
    }

    // Phase 3: Evaluate response
    timestamps.evaluationStart = new Date();
    try {
      const verdict = await this.judgeEvaluator.evaluate(input, response, turnId);
      timestamps.evaluationEnd = new Date();

      const status: TurnStatus = verdict.verdict === 'PASSED' ? 'passed' : 'failed';

      return {
        turnId,
        turnIndex,
        status,
        profile,
        input,
        response,
        verdict,
        timestamps,
      };
    } catch (error: unknown) {
      timestamps.evaluationEnd = new Date();
      const turnError = this.buildTurnError('evaluation', error);
      this.logError(turnId, turnError);
      return {
        turnId,
        turnIndex,
        status: 'evaluation_error',
        profile,
        input,
        response,
        error: turnError,
        timestamps,
      };
    }
  }

  /**
   * Builds a TurnError from a caught exception.
   */
  private buildTurnError(
    phase: TurnError['phase'],
    error: unknown
  ): TurnError {
    if (error instanceof Error) {
      return {
        phase,
        type: error.name || 'Error',
        message: error.message || 'Unknown error',
      };
    }
    return {
      phase,
      type: 'unknown',
      message: String(error),
    };
  }

  /**
   * Logs a per-turn error with turn ID, phase, error type, message, and timestamp.
   */
  private logError(turnId: string, error: TurnError): void {
    const timestamp = new Date().toISOString();
    console.error(
      `[${timestamp}] Error in ${turnId} | Phase: ${error.phase} | Type: ${error.type} | Message: ${error.message}`
    );
  }

  /**
   * Calculates the exit code based on pass rate vs configured threshold.
   * Exit code 0 if pass rate >= threshold, 1 otherwise.
   */
  private calculateExitCode(turns: TestTurnResult[]): number {
    const passedCount = turns.filter((t) => t.status === 'passed').length;
    const failedCount = turns.filter((t) => t.status === 'failed').length;
    const totalExecuted = passedCount + failedCount;

    if (totalExecuted === 0) {
      // No turns were fully executed (all skipped/errored)
      // If threshold is 0, pass; otherwise fail
      return this.testPlan.passThreshold === 0 ? 0 : 1;
    }

    const passRate = (passedCount / totalExecuted) * 100;
    return passRate >= this.testPlan.passThreshold ? 0 : 1;
  }

  /**
   * Builds the test plan context string to pass to the Input Generator.
   * Includes priority areas and special instructions.
   */
  private buildTestPlanContext(): string {
    const parts: string[] = [];

    if (this.testPlan.priorityAreas.length > 0) {
      parts.push('## Priority Areas');
      for (const area of this.testPlan.priorityAreas) {
        parts.push(`- ${area}`);
      }
      parts.push('');
    }

    if (this.testPlan.specialInstructions) {
      parts.push('## Special Instructions');
      parts.push(this.testPlan.specialInstructions);
    }

    return parts.join('\n');
  }
}
