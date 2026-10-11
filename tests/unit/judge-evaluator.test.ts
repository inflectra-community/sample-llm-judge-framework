/**
 * Unit tests for Judge Evaluator Agent
 *
 * Tests deterministic rule-based evaluation of API responses against the API contract.
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 10.5, 10.8
 */

import { describe, it, expect } from 'vitest';
import { JudgeEvaluatorAgent } from '../../src/agents/judge-evaluator';
import { APIContract, APIResponse, GeneratedInput } from '../../src/types';

/** Helper to create a minimal valid API contract for testing. */
function createTestContract(overrides?: Partial<APIContract>): APIContract {
  return {
    format: 'openapi',
    raw: {},
    endpointPath: '/chat',
    requestSchema: {
      requiredFields: [
        { name: 'message', type: 'string', required: true },
      ],
      requiredHeaders: { 'Content-Type': 'application/json' },
      contentType: 'application/json',
    },
    responseSchema: {
      successStatusCodes: [200],
      errorStatusCodes: [400, 500],
      bodyStructure: [
        { name: 'reply', type: 'string', required: true },
        { name: 'timestamp', type: 'number', required: true },
      ],
      errorFormat: [
        { name: 'error', type: 'string', required: true },
        { name: 'code', type: 'number', required: true },
      ],
    },
    ...overrides,
  };
}

/** Helper to create a valid GeneratedInput. */
function createTestInput(overrides?: Partial<GeneratedInput>): GeneratedInput {
  return {
    payload: { message: 'Hello' },
    profile: 'happy_path',
    contentType: 'application/json',
    metadata: { description: 'Test input' },
    ...overrides,
  };
}

/** Helper to create a valid success APIResponse. */
function createSuccessResponse(overrides?: Partial<APIResponse>): APIResponse {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: { reply: 'Hello there!', timestamp: 1234567890 },
    latencyMs: 150,
    ...overrides,
  };
}

describe('JudgeEvaluatorAgent', () => {
  const steering = '# Judge Agent Steering\nEvaluate responses strictly.';
  const contract = createTestContract();

  describe('constructor', () => {
    it('should initialize with steering and contract', () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      expect(agent).toBeInstanceOf(JudgeEvaluatorAgent);
    });
  });

  describe('evaluate - successful responses', () => {
    it('should produce PASSED verdict for valid response matching contract', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse();

      const verdict = await agent.evaluate(input, response, 'turn-001');

      expect(verdict.testId).toBe('turn-001');
      expect(verdict.verdict).toBe('PASSED');
      expect(verdict.failureCategory).toBe('NONE');
      expect(verdict.confidenceScore).toBe(1.0);
      expect(verdict.summary.length).toBeGreaterThan(0);
      expect(verdict.summary.length).toBeLessThanOrEqual(200);
      expect(verdict.assertions.length).toBeGreaterThanOrEqual(1);
      expect(verdict.assertions.length).toBeLessThanOrEqual(50);
    });

    it('should allow extra fields not in contract (Req 10.8)', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({
        body: {
          reply: 'Hello!',
          timestamp: 123456,
          extraField: 'should not cause violation',
          anotherExtra: { nested: true },
        },
      });

      const verdict = await agent.evaluate(input, response, 'turn-002');

      expect(verdict.verdict).toBe('PASSED');
      expect(verdict.failureCategory).toBe('NONE');
    });
  });

  describe('evaluate - malformed/unparseable responses', () => {
    it('should produce FAILED/UNHANDLED_EXCEPTION for null body', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({ body: null });

      const verdict = await agent.evaluate(input, response, 'turn-003');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('UNHANDLED_EXCEPTION');
    });

    it('should produce FAILED/UNHANDLED_EXCEPTION for non-object body (string)', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({ body: 'not json' });

      const verdict = await agent.evaluate(input, response, 'turn-004');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('UNHANDLED_EXCEPTION');
    });

    it('should produce FAILED/UNHANDLED_EXCEPTION for array body', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({ body: [1, 2, 3] });

      const verdict = await agent.evaluate(input, response, 'turn-005');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('UNHANDLED_EXCEPTION');
    });

    it('should produce FAILED/UNHANDLED_EXCEPTION for number body', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({ body: 42 });

      const verdict = await agent.evaluate(input, response, 'turn-006');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('UNHANDLED_EXCEPTION');
    });
  });

  describe('evaluate - connection/transport errors', () => {
    it('should produce FAILED/UNHANDLED_EXCEPTION for timeout error', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response: APIResponse = {
        statusCode: 0,
        headers: {},
        body: null,
        latencyMs: 30000,
        error: { type: 'timeout', message: 'Request timed out after 30000ms' },
      };

      const verdict = await agent.evaluate(input, response, 'turn-007');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('UNHANDLED_EXCEPTION');
      expect(verdict.assertions.some(a => a.check.includes('Connection'))).toBe(true);
    });

    it('should produce FAILED/UNHANDLED_EXCEPTION for connection refused', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response: APIResponse = {
        statusCode: 0,
        headers: {},
        body: null,
        latencyMs: 0,
        error: { type: 'connection_refused', message: 'Connection refused' },
      };

      const verdict = await agent.evaluate(input, response, 'turn-008');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('UNHANDLED_EXCEPTION');
    });
  });

  describe('evaluate - schema violations', () => {
    it('should produce FAILED/SCHEMA_VIOLATION for unknown status code', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({ statusCode: 418 });

      const verdict = await agent.evaluate(input, response, 'turn-009');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('SCHEMA_VIOLATION');
    });

    it('should produce FAILED/SCHEMA_VIOLATION for missing required field', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({
        body: { reply: 'Hello!' }, // missing 'timestamp'
      });

      const verdict = await agent.evaluate(input, response, 'turn-010');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('SCHEMA_VIOLATION');
    });

    it('should produce FAILED/SCHEMA_VIOLATION for wrong field type', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({
        body: { reply: 'Hello!', timestamp: 'not-a-number' },
      });

      const verdict = await agent.evaluate(input, response, 'turn-011');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('SCHEMA_VIOLATION');
    });

    it('should produce FAILED/SCHEMA_VIOLATION for missing error format fields', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response: APIResponse = {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: { message: 'Bad request' }, // missing 'error' and 'code' fields
        latencyMs: 50,
      };

      const verdict = await agent.evaluate(input, response, 'turn-012');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('SCHEMA_VIOLATION');
    });
  });

  describe('evaluate - performance issues', () => {
    it('should produce FAILED/PERFORMANCE_ISSUE for latency > 5000ms', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({ latencyMs: 5001 });

      const verdict = await agent.evaluate(input, response, 'turn-013');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('PERFORMANCE_ISSUE');
    });

    it('should PASS for latency exactly at 5000ms', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({ latencyMs: 5000 });

      const verdict = await agent.evaluate(input, response, 'turn-014');

      expect(verdict.verdict).toBe('PASSED');
    });
  });

  describe('evaluate - verdict structure invariants', () => {
    it('should have PASSED → failureCategory = NONE', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse();

      const verdict = await agent.evaluate(input, response, 'turn-015');

      expect(verdict.verdict).toBe('PASSED');
      expect(verdict.failureCategory).toBe('NONE');
    });

    it('should have FAILED → failureCategory != NONE', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({ body: null });

      const verdict = await agent.evaluate(input, response, 'turn-016');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).not.toBe('NONE');
    });

    it('should have confidenceScore between 0.0 and 1.0', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse();

      const verdict = await agent.evaluate(input, response, 'turn-017');

      expect(verdict.confidenceScore).toBeGreaterThanOrEqual(0.0);
      expect(verdict.confidenceScore).toBeLessThanOrEqual(1.0);
    });

    it('should have summary between 1 and 200 characters', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse();

      const verdict = await agent.evaluate(input, response, 'turn-018');

      expect(verdict.summary.length).toBeGreaterThanOrEqual(1);
      expect(verdict.summary.length).toBeLessThanOrEqual(200);
    });

    it('should have assertions between 1 and 50 entries', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse();

      const verdict = await agent.evaluate(input, response, 'turn-019');

      expect(verdict.assertions.length).toBeGreaterThanOrEqual(1);
      expect(verdict.assertions.length).toBeLessThanOrEqual(50);
    });

    it('should have testId matching the provided turnId', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse();

      const verdict = await agent.evaluate(input, response, 'my-custom-id');

      expect(verdict.testId).toBe('my-custom-id');
    });
  });

  describe('evaluate - confidence score logic', () => {
    it('should return 1.0 when all assertions pass', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse();

      const verdict = await agent.evaluate(input, response, 'turn-020');

      expect(verdict.confidenceScore).toBe(1.0);
    });

    it('should return 0.8 when some assertions pass (more passes than fails)', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      // High latency causes one FAIL among several PASSes
      const response = createSuccessResponse({ latencyMs: 6000 });

      const verdict = await agent.evaluate(input, response, 'turn-021');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.confidenceScore).toBe(0.8);
    });

    it('should return 0.5 when mostly fail', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      // Connection error produces a single FAIL assertion
      const response: APIResponse = {
        statusCode: 0,
        headers: {},
        body: null,
        latencyMs: 0,
        error: { type: 'timeout', message: 'Timed out' },
      };

      const verdict = await agent.evaluate(input, response, 'turn-022');

      expect(verdict.confidenceScore).toBe(0.5);
    });
  });

  describe('evaluate - error response format validation', () => {
    it('should PASS for valid error response with correct format', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response: APIResponse = {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: { error: 'Invalid input', code: 400 },
        latencyMs: 50,
      };

      const verdict = await agent.evaluate(input, response, 'turn-023');

      expect(verdict.verdict).toBe('PASSED');
      expect(verdict.failureCategory).toBe('NONE');
    });
  });

  describe('evaluate - body as JSON string', () => {
    it('should parse JSON string body as object', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({
        body: JSON.stringify({ reply: 'Hello!', timestamp: 123456 }),
      });

      const verdict = await agent.evaluate(input, response, 'turn-024');

      expect(verdict.verdict).toBe('PASSED');
    });

    it('should fail for unparseable JSON string body', async () => {
      const agent = new JudgeEvaluatorAgent(steering, contract);
      const input = createTestInput();
      const response = createSuccessResponse({
        body: '{invalid json}',
      });

      const verdict = await agent.evaluate(input, response, 'turn-025');

      expect(verdict.verdict).toBe('FAILED');
      expect(verdict.failureCategory).toBe('UNHANDLED_EXCEPTION');
    });
  });
});
