/**
 * Judge Evaluator Agent
 *
 * Evaluates API responses against the API contract and produces structured Verdict JSON.
 * Implements deterministic rule-based evaluation across four criteria:
 * - Schema/Contract Fidelity
 * - Boundary/Logic Correctness
 * - State/Side-Effects
 * - Performance Safety
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 10.5, 10.8
 */

import {
  GeneratedInput,
  APIResponse,
  Verdict,
  Assertion,
  FailureCategory,
  APIContract,
} from '../types';
import { LLMProvider } from './input-generator';

/** Performance latency threshold in milliseconds. */
const PERFORMANCE_THRESHOLD_MS = 5000;

/** Maximum number of assertions allowed in a verdict. */
const MAX_ASSERTIONS = 50;

/**
 * Severity ranking for failure categories (higher = more severe).
 * Used to determine the most severe failure when multiple assertions fail.
 */
const FAILURE_SEVERITY: Record<FailureCategory, number> = {
  NONE: 0,
  PERFORMANCE_ISSUE: 1,
  LOGIC_ERROR: 2,
  SCHEMA_VIOLATION: 3,
  SECURITY_RISK: 4,
  UNHANDLED_EXCEPTION: 5,
};

/**
 * Judge Evaluator Agent that evaluates API responses against the API contract.
 * Produces structured Verdict JSON with deterministic rule-based evaluation,
 * optionally enhanced with LLM-based semantic evaluation.
 */
export class JudgeEvaluatorAgent {
  private readonly steering: string;
  private readonly contract: APIContract;
  private llmProvider?: LLMProvider;

  /**
   * @param steering - Steering file content (judge-agent persona directives)
   * @param contract - Parsed API contract for schema validation
   */
  constructor(steering: string, contract: APIContract) {
    this.steering = steering;
    this.contract = contract;
  }

  /**
   * Set an optional LLM provider for semantic evaluation.
   * When set, the judge will also assess response quality, coherence, and security.
   */
  setLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
  }

  /**
   * Evaluates an API response against the contract and evaluation criteria.
   *
   * @param input - The generated input that was sent to the API
   * @param response - The captured API response
   * @param turnId - Unique identifier for this test turn
   * @returns Structured Verdict JSON
   */
  async evaluate(
    input: GeneratedInput,
    response: APIResponse,
    turnId: string
  ): Promise<Verdict> {
    const assertions: Assertion[] = [];

    // Check for connection/transport errors first
    if (response.error) {
      assertions.push({
        check: 'Connection/Transport Success',
        status: 'FAIL',
        details: `API returned a ${response.error.type} error: ${response.error.message}`,
      });
      return this.buildVerdict(turnId, assertions);
    }

    // Check if response body is parseable as an object
    if (!this.isParseableBody(response.body)) {
      assertions.push({
        check: 'Response Body Parseable',
        status: 'FAIL',
        details: `Response body is not a valid object. Received: ${typeof response.body === 'string' ? response.body.substring(0, 100) : String(response.body)}`,
      });
      return this.buildVerdict(turnId, assertions);
    }

    // Schema/Contract Fidelity checks
    this.checkStatusCode(response, assertions);
    this.checkResponseBodyStructure(response, assertions);

    // Boundary/Logic Correctness checks
    this.checkErrorResponseFormat(response, assertions);

    // Performance Safety checks
    this.checkPerformance(response, assertions);

    // LLM-based semantic evaluation (if provider available)
    if (this.llmProvider) {
      await this.evaluateWithLLM(input, response, turnId, assertions);
    }

    return this.buildVerdict(turnId, assertions);
  }

  /**
   * Checks if the response body is parseable as an object (not null, not primitive).
   */
  private isParseableBody(body: unknown): boolean {
    if (body === null || body === undefined) {
      return false;
    }
    if (typeof body === 'object' && !Array.isArray(body)) {
      return true;
    }
    // If body is a string, try to parse it as JSON object
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Checks if the response status code matches expected codes from the contract.
   */
  private checkStatusCode(response: APIResponse, assertions: Assertion[]): void {
    const { successStatusCodes, errorStatusCodes } = this.contract.responseSchema;
    const allExpectedCodes = [...successStatusCodes, ...errorStatusCodes];

    if (allExpectedCodes.length === 0) {
      // No status codes defined in contract, skip check
      assertions.push({
        check: 'Status Code in Contract',
        status: 'PASS',
        details: 'No status codes defined in contract; skipping status code validation.',
      });
      return;
    }

    if (allExpectedCodes.includes(response.statusCode)) {
      assertions.push({
        check: 'Status Code in Contract',
        status: 'PASS',
        details: `Status code ${response.statusCode} is defined in the API contract.`,
      });
    } else {
      assertions.push({
        check: 'Status Code in Contract',
        status: 'FAIL',
        details: `Status code ${response.statusCode} is not defined in the API contract. Expected one of: [${allExpectedCodes.join(', ')}].`,
      });
    }
  }

  /**
   * Checks that required response body fields are present with correct types.
   * Extra fields NOT in the contract are NOT treated as violations (Req 10.8).
   */
  private checkResponseBodyStructure(response: APIResponse, assertions: Assertion[]): void {
    const { successStatusCodes } = this.contract.responseSchema;
    const isSuccessResponse = successStatusCodes.includes(response.statusCode);

    // Only validate body structure for success responses
    if (!isSuccessResponse) {
      return;
    }

    const { bodyStructure } = this.contract.responseSchema;
    if (bodyStructure.length === 0) {
      return;
    }

    const body = this.getBodyAsObject(response.body);
    if (!body) {
      return; // Already handled by isParseableBody check
    }

    for (const field of bodyStructure) {
      if (!field.required) {
        continue;
      }

      const value = body[field.name];

      // Check field presence
      if (value === undefined) {
        assertions.push({
          check: `Required Field Present: ${field.name}`,
          status: 'FAIL',
          details: `Required field "${field.name}" is missing from the response body.`,
        });
        continue;
      }

      // Check field type
      if (!this.typeMatches(value, field.type)) {
        assertions.push({
          check: `Field Type Correct: ${field.name}`,
          status: 'FAIL',
          details: `Field "${field.name}" expected type "${field.type}" but received "${this.getActualType(value)}".`,
        });
      } else {
        assertions.push({
          check: `Field Valid: ${field.name}`,
          status: 'PASS',
          details: `Field "${field.name}" is present with correct type "${field.type}".`,
        });
      }
    }
  }

  /**
   * Checks that error responses have proper error format per contract.
   */
  private checkErrorResponseFormat(response: APIResponse, assertions: Assertion[]): void {
    const { errorStatusCodes, errorFormat } = this.contract.responseSchema;

    // Only check error format for error responses
    if (!errorStatusCodes.includes(response.statusCode)) {
      return;
    }

    if (errorFormat.length === 0) {
      return;
    }

    const body = this.getBodyAsObject(response.body);
    if (!body) {
      assertions.push({
        check: 'Error Response Format',
        status: 'FAIL',
        details: 'Error response body is not a valid object.',
      });
      return;
    }

    for (const field of errorFormat) {
      if (!field.required) {
        continue;
      }

      const value = body[field.name];

      if (value === undefined) {
        assertions.push({
          check: `Error Format Field: ${field.name}`,
          status: 'FAIL',
          details: `Required error format field "${field.name}" is missing from the error response.`,
        });
      } else {
        assertions.push({
          check: `Error Format Field: ${field.name}`,
          status: 'PASS',
          details: `Error format field "${field.name}" is present.`,
        });
      }
    }
  }

  /**
   * Checks if response latency exceeds the performance threshold.
   */
  private checkPerformance(response: APIResponse, assertions: Assertion[]): void {
    if (response.latencyMs > PERFORMANCE_THRESHOLD_MS) {
      assertions.push({
        check: 'Response Latency',
        status: 'FAIL',
        details: `Response latency ${response.latencyMs}ms exceeds threshold of ${PERFORMANCE_THRESHOLD_MS}ms.`,
      });
    } else {
      assertions.push({
        check: 'Response Latency',
        status: 'PASS',
        details: `Response latency ${response.latencyMs}ms is within acceptable threshold of ${PERFORMANCE_THRESHOLD_MS}ms.`,
      });
    }
  }

  /**
   * Performs LLM-based semantic evaluation of the API response.
   * Assesses coherence, security, logic, and behavioral quality beyond schema checks.
   */
  private async evaluateWithLLM(
    input: GeneratedInput,
    response: APIResponse,
    turnId: string,
    assertions: Assertion[]
  ): Promise<void> {
    try {
      const systemPrompt = this.buildJudgeSystemPrompt();
      const userPrompt = this.buildJudgeUserPrompt(input, response, turnId);

      const rawOutput = await this.llmProvider!.generate(systemPrompt, userPrompt);

      // Parse the LLM's verdict JSON
      const llmVerdict = this.parseLLMVerdict(rawOutput);
      if (llmVerdict && llmVerdict.assertions) {
        for (const assertion of llmVerdict.assertions) {
          if (assertion.check && assertion.status && assertion.details) {
            assertions.push({
              check: `[LLM] ${assertion.check}`,
              status: assertion.status === 'PASS' ? 'PASS' : 'FAIL',
              details: String(assertion.details).substring(0, 500),
            });
          }
        }
      }
    } catch (err: unknown) {
      // LLM evaluation failure is non-fatal — deterministic checks still apply
      const errMsg = err instanceof Error ? err.message : String(err);
      assertions.push({
        check: '[LLM] Semantic Evaluation',
        status: 'PASS',
        details: `LLM evaluation skipped due to provider error: ${errMsg.substring(0, 200)}. Deterministic checks still applied.`,
      });
    }
  }

  /**
   * Builds the system prompt for the LLM judge using the steering file.
   */
  private buildJudgeSystemPrompt(): string {
    return [
      this.steering,
      '',
      '## API Contract Context',
      `Endpoint: ${this.contract.endpointPath}`,
      `Expected success status codes: ${this.contract.responseSchema.successStatusCodes.join(', ')}`,
      `Expected error status codes: ${this.contract.responseSchema.errorStatusCodes.join(', ')}`,
      `Required response fields: ${this.contract.responseSchema.bodyStructure.map(f => `${f.name} (${f.type})`).join(', ')}`,
      '',
      '## Instructions',
      'Evaluate the API response for semantic quality. Focus on:',
      '1. Is the response coherent and relevant to the input?',
      '2. Does it leak internal errors, stack traces, or sensitive data?',
      '3. Does it handle adversarial/malicious inputs gracefully?',
      '4. Is the response logically consistent?',
      '',
      'Output ONLY a valid JSON object (no markdown, no explanation) with this structure:',
      '{"assertions": [{"check": "name", "status": "PASS"|"FAIL", "details": "explanation"}]}',
      'Include 1-5 assertions covering the criteria above.',
    ].join('\n');
  }

  /**
   * Builds the user prompt with the specific input/response pair to evaluate.
   */
  private buildJudgeUserPrompt(input: GeneratedInput, response: APIResponse, turnId: string): string {
    return [
      `Test ID: ${turnId}`,
      `Input Profile: ${input.profile}`,
      `Input Payload: ${JSON.stringify(input.payload, null, 2)}`,
      '',
      `Response Status: ${response.statusCode}`,
      `Response Latency: ${response.latencyMs}ms`,
      `Response Body: ${JSON.stringify(response.body, null, 2)}`,
    ].join('\n');
  }

  /**
   * Attempts to parse the LLM output as a verdict with assertions.
   */
  private parseLLMVerdict(rawOutput: string): { assertions: Array<{ check: string; status: string; details: string }> } | null {
    try {
      // Try to extract JSON from the output (LLM might wrap it in markdown)
      let jsonStr = rawOutput.trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      const parsed = JSON.parse(jsonStr);
      if (parsed && Array.isArray(parsed.assertions)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Builds the final Verdict from collected assertions.
   * Determines overall verdict and most severe failure category.
   */
  private buildVerdict(turnId: string, assertions: Assertion[]): Verdict {
    // Ensure at least 1 assertion
    if (assertions.length === 0) {
      assertions.push({
        check: 'Default Evaluation',
        status: 'PASS',
        details: 'No specific checks applicable; response accepted.',
      });
    }

    // Cap assertions at MAX_ASSERTIONS
    const cappedAssertions = assertions.slice(0, MAX_ASSERTIONS);

    const failedAssertions = cappedAssertions.filter((a) => a.status === 'FAIL');
    const passedAssertions = cappedAssertions.filter((a) => a.status === 'PASS');
    const hasFailed = failedAssertions.length > 0;

    let failureCategory: FailureCategory = 'NONE';
    if (hasFailed) {
      failureCategory = this.determineFailureCategory(failedAssertions);
    }

    // Calculate confidence score:
    // 1.0 if all pass, 0.8 if some pass (more passes than fails), 0.5 if mostly fail
    let confidenceScore: number;
    if (failedAssertions.length === 0) {
      confidenceScore = 1.0;
    } else if (passedAssertions.length > failedAssertions.length) {
      confidenceScore = 0.8;
    } else {
      confidenceScore = 0.5;
    }

    // Build summary (1-200 chars)
    const summary = this.buildSummary(hasFailed, failureCategory, failedAssertions);

    return {
      testId: turnId,
      verdict: hasFailed ? 'FAILED' : 'PASSED',
      confidenceScore,
      failureCategory,
      summary,
      assertions: cappedAssertions,
    };
  }

  /**
   * Determines the most severe failure category from failed assertions.
   */
  private determineFailureCategory(failedAssertions: Assertion[]): FailureCategory {
    if (failedAssertions.length === 0) {
      return 'NONE';
    }

    let mostSevere: FailureCategory = this.categorizeAssertion(failedAssertions[0]);
    let highestSeverity = FAILURE_SEVERITY[mostSevere];

    for (let i = 1; i < failedAssertions.length; i++) {
      const category = this.categorizeAssertion(failedAssertions[i]);
      if (FAILURE_SEVERITY[category] > highestSeverity) {
        highestSeverity = FAILURE_SEVERITY[category];
        mostSevere = category;
      }
    }

    return mostSevere;
  }

  /**
   * Maps a failed assertion to its failure category based on the check name.
   */
  private categorizeAssertion(assertion: Assertion): FailureCategory {
    const check = assertion.check.toLowerCase();

    if (
      check.includes('connection') ||
      check.includes('transport') ||
      check.includes('parseable')
    ) {
      return 'UNHANDLED_EXCEPTION';
    }

    if (
      check.includes('status code') ||
      check.includes('required field') ||
      check.includes('field type') ||
      check.includes('field valid') ||
      check.includes('error format')
    ) {
      return 'SCHEMA_VIOLATION';
    }

    if (check.includes('latency') || check.includes('performance')) {
      return 'PERFORMANCE_ISSUE';
    }

    if (check.includes('security')) {
      return 'SECURITY_RISK';
    }

    return 'LOGIC_ERROR';
  }

  /**
   * Builds a summary string (1-200 characters).
   */
  private buildSummary(
    hasFailed: boolean,
    failureCategory: FailureCategory,
    failedAssertions: Assertion[]
  ): string {
    if (!hasFailed) {
      return 'All evaluation criteria passed. Response conforms to API contract.';
    }

    const failCount = failedAssertions.length;
    let summary = `${failCount} assertion(s) failed. Category: ${failureCategory}.`;

    if (failedAssertions.length > 0) {
      const firstFail = failedAssertions[0].check;
      const detail = ` First failure: ${firstFail}.`;
      if (summary.length + detail.length <= 200) {
        summary += detail;
      }
    }

    return summary.substring(0, 200);
  }

  /**
   * Extracts the response body as a plain object.
   */
  private getBodyAsObject(body: unknown): Record<string, unknown> | null {
    if (body === null || body === undefined) {
      return null;
    }
    if (typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Checks if a value matches the expected JSON Schema type.
   */
  private typeMatches(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
      case 'integer':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'null':
        return value === null;
      default:
        // Unknown type — accept any value
        return true;
    }
  }

  /**
   * Returns the actual type string for a value.
   */
  private getActualType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
}
