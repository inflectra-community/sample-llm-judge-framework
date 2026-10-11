import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateReport, writeReport, formatTimestamp } from '../../src/report-generator';
import {
  TestSuiteResult,
  TestPlan,
  TestTurnResult,
  InputProfile,
  ResolvedConfig,
} from '../../src/types';

// Helper to create a minimal ResolvedConfig
function makeConfig(): ResolvedConfig {
  return {
    endpoint: 'http://localhost:3000',
    turnCount: 10,
    timeoutMs: 30000,
    executionMode: 'sequential',
    concurrencyLimit: 5,
    contractPath: './api-contract.json',
    verbose: false,
    steeringPaths: {
      inputAgent: '.kiro/steering/input-agent.md',
      judgeAgent: '.kiro/steering/judge-agent.md',
      testPlan: '.kiro/steering/test-plan.md',
    },
    outputDir: './output',
  };
}

// Helper to create a minimal TestPlan
function makeTestPlan(): TestPlan {
  return {
    profileDistribution: {
      happy_path: 25,
      boundary_values: 25,
      malicious_content: 25,
      structural_anomalies: 25,
    },
    scenarioSequences: [],
    priorityAreas: [],
    passThreshold: 100,
    specialInstructions: '',
  };
}

// Helper to create a passed turn
function makePassedTurn(index: number, profile: InputProfile = 'happy_path'): TestTurnResult {
  return {
    turnId: `turn-${String(index).padStart(3, '0')}`,
    turnIndex: index,
    status: 'passed',
    profile,
    input: { payload: { message: 'hello' }, profile, contentType: 'application/json', metadata: { description: 'test' } },
    response: { statusCode: 200, headers: {}, body: { reply: 'hi' }, latencyMs: 50 },
    verdict: {
      testId: `turn-${String(index).padStart(3, '0')}`,
      verdict: 'PASSED',
      confidenceScore: 0.95,
      failureCategory: 'NONE',
      summary: 'All checks passed',
      assertions: [{ check: 'schema', status: 'PASS', details: 'Valid response' }],
    },
    timestamps: {},
  };
}

// Helper to create a failed turn
function makeFailedTurn(
  index: number,
  profile: InputProfile = 'boundary_values',
  category: 'SCHEMA_VIOLATION' | 'UNHANDLED_EXCEPTION' | 'LOGIC_ERROR' | 'SECURITY_RISK' | 'PERFORMANCE_ISSUE' = 'SCHEMA_VIOLATION'
): TestTurnResult {
  return {
    turnId: `turn-${String(index).padStart(3, '0')}`,
    turnIndex: index,
    status: 'failed',
    profile,
    input: { payload: { message: '' }, profile, contentType: 'application/json', metadata: { description: 'boundary test' } },
    response: { statusCode: 500, headers: {}, body: { error: 'internal' }, latencyMs: 200 },
    verdict: {
      testId: `turn-${String(index).padStart(3, '0')}`,
      verdict: 'FAILED',
      confidenceScore: 0.9,
      failureCategory: category,
      summary: 'Schema violation detected',
      assertions: [
        { check: 'response_schema', status: 'FAIL', details: 'Missing required field: reply' },
        { check: 'status_code', status: 'PASS', details: 'Status code in expected range' },
      ],
    },
    timestamps: {},
  };
}

// Helper to create an errored turn
function makeErroredTurn(
  index: number,
  phase: 'input_generation' | 'api_execution' | 'evaluation',
  status: 'skipped' | 'execution_error' | 'evaluation_error' = 'execution_error'
): TestTurnResult {
  return {
    turnId: `turn-${String(index).padStart(3, '0')}`,
    turnIndex: index,
    status,
    profile: 'happy_path',
    error: { phase, type: 'timeout', message: 'Request timed out after 30s' },
    timestamps: {},
  };
}

describe('report-generator', () => {
  describe('formatTimestamp', () => {
    it('formats a date as YYYYMMDDTHHMMSS in UTC', () => {
      const date = new Date('2024-03-15T09:05:30Z');
      expect(formatTimestamp(date)).toBe('20240315T090530');
    });

    it('pads single-digit components with zeros', () => {
      const date = new Date('2024-01-02T03:04:05Z');
      expect(formatTimestamp(date)).toBe('20240102T030405');
    });

    it('handles midnight correctly', () => {
      const date = new Date('2024-12-31T00:00:00Z');
      expect(formatTimestamp(date)).toBe('20241231T000000');
    });
  });

  describe('generateReport', () => {
    it('generates all-pass report with no failed details section', () => {
      const turns = [
        makePassedTurn(0, 'happy_path'),
        makePassedTurn(1, 'boundary_values'),
        makePassedTurn(2, 'malicious_content'),
        makePassedTurn(3, 'structural_anomalies'),
      ];
      const suiteResult: TestSuiteResult = {
        turns,
        startTime: new Date('2024-03-15T09:00:00Z'),
        endTime: new Date('2024-03-15T09:01:00Z'),
        config: makeConfig(),
      };

      const report = generateReport(suiteResult, makeTestPlan());

      expect(report).toContain('# Test Suite Summary Report');
      expect(report).toContain('| Pass Rate | 100.0% |');
      expect(report).toContain('✅ All tests passed! No failures detected.');
      expect(report).not.toContain('## Failed Test Details');
    });

    it('calculates pass rate correctly with 1 decimal place', () => {
      const turns = [
        makePassedTurn(0),
        makePassedTurn(1),
        makeFailedTurn(2),
      ];
      const suiteResult: TestSuiteResult = {
        turns,
        startTime: new Date(),
        endTime: new Date(),
        config: makeConfig(),
      };

      const report = generateReport(suiteResult, makeTestPlan());

      // 2/3 = 66.7%
      expect(report).toContain('| Pass Rate | 66.7% |');
    });

    it('excludes skipped/errored turns from pass rate denominator', () => {
      const turns = [
        makePassedTurn(0),
        makePassedTurn(1),
        makeFailedTurn(2),
        makeErroredTurn(3, 'api_execution', 'execution_error'),
      ];
      const suiteResult: TestSuiteResult = {
        turns,
        startTime: new Date(),
        endTime: new Date(),
        config: makeConfig(),
      };

      const report = generateReport(suiteResult, makeTestPlan());

      // totalExecuted = 2 passed + 1 failed = 3, passRate = 2/3 = 66.7%
      expect(report).toContain('| Total Tests | 4 |');
      expect(report).toContain('| Pass Rate | 66.7% |');
      expect(report).toContain('| Skipped/Errored | 1 |');
    });

    it('includes failure breakdown by category', () => {
      const turns = [
        makeFailedTurn(0, 'happy_path', 'SCHEMA_VIOLATION'),
        makeFailedTurn(1, 'boundary_values', 'SCHEMA_VIOLATION'),
        makeFailedTurn(2, 'malicious_content', 'SECURITY_RISK'),
        makePassedTurn(3),
      ];
      const suiteResult: TestSuiteResult = {
        turns,
        startTime: new Date(),
        endTime: new Date(),
        config: makeConfig(),
      };

      const report = generateReport(suiteResult, makeTestPlan());

      expect(report).toContain('| SCHEMA_VIOLATION | 2 |');
      expect(report).toContain('| SECURITY_RISK | 1 |');
      expect(report).toContain('| LOGIC_ERROR | 0 |');
    });

    it('includes profile breakdown with correct counts', () => {
      const turns = [
        makePassedTurn(0, 'happy_path'),
        makeFailedTurn(1, 'happy_path', 'LOGIC_ERROR'),
        makePassedTurn(2, 'boundary_values'),
        makePassedTurn(3, 'malicious_content'),
      ];
      const suiteResult: TestSuiteResult = {
        turns,
        startTime: new Date(),
        endTime: new Date(),
        config: makeConfig(),
      };

      const report = generateReport(suiteResult, makeTestPlan());

      expect(report).toContain('| Happy Path | 1 | 1 | 50.0% |');
      expect(report).toContain('| Boundary Values | 1 | 0 | 0.0% |');
      expect(report).toContain('| Malicious Content | 1 | 0 | 0.0% |');
      expect(report).toContain('| Structural Anomalies | 0 | 0 | 0.0% |');
    });

    it('includes failed turn details with testId, input, response, category, assertions', () => {
      const turns = [makeFailedTurn(0, 'boundary_values', 'SCHEMA_VIOLATION')];
      const suiteResult: TestSuiteResult = {
        turns,
        startTime: new Date(),
        endTime: new Date(),
        config: makeConfig(),
      };

      const report = generateReport(suiteResult, makeTestPlan());

      expect(report).toContain('turn-000 (failed)');
      expect(report).toContain('**Failure Category:** SCHEMA_VIOLATION');
      expect(report).toContain('**Original Input:**');
      expect(report).toContain('"message": ""');
      expect(report).toContain('**API Response:**');
      expect(report).toContain('"statusCode": 500');
      expect(report).toContain('**Assertions:**');
      expect(report).toContain('| response_schema | FAIL | Missing required field: reply |');
    });

    it('includes error section grouped by phase', () => {
      const turns = [
        makePassedTurn(0),
        makeErroredTurn(1, 'input_generation', 'skipped'),
        makeErroredTurn(2, 'api_execution', 'execution_error'),
        makeErroredTurn(3, 'evaluation', 'evaluation_error'),
      ];
      const suiteResult: TestSuiteResult = {
        turns,
        startTime: new Date(),
        endTime: new Date(),
        config: makeConfig(),
      };

      const report = generateReport(suiteResult, makeTestPlan());

      expect(report).toContain('## Errors and Skipped Turns');
      expect(report).toContain('### Input Generation');
      expect(report).toContain('| turn-001 | input_generation | timeout | Request timed out after 30s |');
      expect(report).toContain('### API Execution');
      expect(report).toContain('| turn-002 | api_execution | timeout | Request timed out after 30s |');
      expect(report).toContain('### Evaluation');
      expect(report).toContain('| turn-003 | evaluation | timeout | Request timed out after 30s |');
    });

    it('omits error section when no skipped/errored turns', () => {
      const turns = [makePassedTurn(0), makeFailedTurn(1)];
      const suiteResult: TestSuiteResult = {
        turns,
        startTime: new Date(),
        endTime: new Date(),
        config: makeConfig(),
      };

      const report = generateReport(suiteResult, makeTestPlan());

      expect(report).not.toContain('## Errors and Skipped Turns');
    });
  });

  describe('writeReport', () => {
    const tmpDir = path.join(__dirname, '..', '..', 'tmp-test-output');

    afterEach(() => {
      // Clean up temp directory
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('writes report to correct filename with UTC timestamp', () => {
      const startTime = new Date('2024-06-15T14:30:45Z');
      const result = writeReport('# Report Content', tmpDir, startTime);

      const expectedPath = path.join(tmpDir, 'summary_report_20240615T143045.md');
      expect(result).toBe(expectedPath);
      expect(fs.existsSync(expectedPath)).toBe(true);
      expect(fs.readFileSync(expectedPath, 'utf-8')).toBe('# Report Content');
    });

    it('creates output directory if it does not exist', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'dir');
      expect(fs.existsSync(nestedDir)).toBe(false);

      writeReport('# Report', nestedDir, new Date('2024-01-01T00:00:00Z'));

      expect(fs.existsSync(nestedDir)).toBe(true);
      const expectedFile = path.join(nestedDir, 'summary_report_20240101T000000.md');
      expect(fs.existsSync(expectedFile)).toBe(true);
    });
  });
});
