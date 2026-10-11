import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTestPlan, TestPlanError } from '../../src/test-plan-parser';

const TEST_DIR = join(tmpdir(), 'test-plan-parser-fixtures');

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('parseTestPlan', () => {
  describe('fallback to defaults', () => {
    it('should return defaults when file is missing', async () => {
      const filePath = join(TEST_DIR, 'nonexistent.md');
      const result = await parseTestPlan(filePath, 20);

      expect(result.profileDistribution).toEqual({
        happy_path: 25,
        boundary_values: 25,
        malicious_content: 25,
        structural_anomalies: 25,
      });
      expect(result.scenarioSequences).toEqual([]);
      expect(result.priorityAreas).toEqual([]);
      expect(result.passThreshold).toBe(100);
      expect(result.specialInstructions).toBe('');
    });

    it('should return defaults when file is empty', async () => {
      const filePath = join(TEST_DIR, 'empty.md');
      await writeFile(filePath, '', 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.profileDistribution).toEqual({
        happy_path: 25,
        boundary_values: 25,
        malicious_content: 25,
        structural_anomalies: 25,
      });
      expect(result.passThreshold).toBe(100);
    });

    it('should return defaults when file is whitespace-only', async () => {
      const filePath = join(TEST_DIR, 'whitespace.md');
      await writeFile(filePath, '   \n\t\n   \r\n  ', 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.profileDistribution).toEqual({
        happy_path: 25,
        boundary_values: 25,
        malicious_content: 25,
        structural_anomalies: 25,
      });
      expect(result.passThreshold).toBe(100);
    });
  });

  describe('profile distribution parsing', () => {
    it('should parse valid profile distribution', async () => {
      const filePath = join(TEST_DIR, 'valid-distribution.md');
      const content = `## Profile Distribution
happy_path: 40
boundary_values: 30
malicious_content: 20
structural_anomalies: 10
`;
      await writeFile(filePath, content, 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.profileDistribution).toEqual({
        happy_path: 40,
        boundary_values: 30,
        malicious_content: 20,
        structural_anomalies: 10,
      });
    });

    it('should reject distribution that does not sum to 100', async () => {
      const filePath = join(TEST_DIR, 'bad-sum.md');
      const content = `## Profile Distribution
happy_path: 30
boundary_values: 30
malicious_content: 30
structural_anomalies: 30
`;
      await writeFile(filePath, content, 'utf-8');

      await expect(parseTestPlan(filePath, 20)).rejects.toThrow(TestPlanError);
      await expect(parseTestPlan(filePath, 20)).rejects.toThrow('sum to 100');
    });

    it('should reject distribution with value outside 0-100', async () => {
      const filePath = join(TEST_DIR, 'out-of-range.md');
      const content = `## Profile Distribution
happy_path: 150
boundary_values: -20
malicious_content: -20
structural_anomalies: -10
`;
      await writeFile(filePath, content, 'utf-8');

      // Negative values won't match the \d+ regex, so only 150 is parsed
      // Since only one profile is specified and it's > 100, it should throw
      await expect(parseTestPlan(filePath, 20)).rejects.toThrow(TestPlanError);
    });

    it('should allow zero percentages', async () => {
      const filePath = join(TEST_DIR, 'zero-profiles.md');
      const content = `## Profile Distribution
happy_path: 100
boundary_values: 0
malicious_content: 0
structural_anomalies: 0
`;
      await writeFile(filePath, content, 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.profileDistribution).toEqual({
        happy_path: 100,
        boundary_values: 0,
        malicious_content: 0,
        structural_anomalies: 0,
      });
    });
  });

  describe('scenario sequences parsing', () => {
    it('should parse scenario sequences', async () => {
      const filePath = join(TEST_DIR, 'scenarios.md');
      const content = `## Profile Distribution
happy_path: 25
boundary_values: 25
malicious_content: 25
structural_anomalies: 25

## Scenario Sequences
- happy_path: Test normal greeting flow
- boundary_values: Send maximum length message
- malicious_content: Attempt SQL injection
`;
      await writeFile(filePath, content, 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.scenarioSequences).toHaveLength(3);
      expect(result.scenarioSequences[0]).toEqual({
        profile: 'happy_path',
        description: 'Test normal greeting flow',
      });
      expect(result.scenarioSequences[1]).toEqual({
        profile: 'boundary_values',
        description: 'Send maximum length message',
      });
      expect(result.scenarioSequences[2]).toEqual({
        profile: 'malicious_content',
        description: 'Attempt SQL injection',
      });
    });

    it('should reject scenario sequence exceeding total turn count', async () => {
      const filePath = join(TEST_DIR, 'overflow-scenarios.md');
      const content = `## Profile Distribution
happy_path: 25
boundary_values: 25
malicious_content: 25
structural_anomalies: 25

## Scenario Sequences
- happy_path: Step 1
- happy_path: Step 2
- happy_path: Step 3
- happy_path: Step 4
- happy_path: Step 5
`;
      await writeFile(filePath, content, 'utf-8');

      // Total turn count is 3, but scenario has 5 steps
      await expect(parseTestPlan(filePath, 3)).rejects.toThrow(TestPlanError);
      await expect(parseTestPlan(filePath, 3)).rejects.toThrow('exceeds the available turn count');
    });
  });

  describe('priority areas parsing', () => {
    it('should parse priority areas', async () => {
      const filePath = join(TEST_DIR, 'priorities.md');
      const content = `## Profile Distribution
happy_path: 25
boundary_values: 25
malicious_content: 25
structural_anomalies: 25

## Priority Areas
- Authentication edge cases
- Rate limiting behavior
- Unicode handling
`;
      await writeFile(filePath, content, 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.priorityAreas).toEqual([
        'Authentication edge cases',
        'Rate limiting behavior',
        'Unicode handling',
      ]);
    });
  });

  describe('threshold parsing', () => {
    it('should parse custom threshold', async () => {
      const filePath = join(TEST_DIR, 'threshold.md');
      const content = `## Profile Distribution
happy_path: 25
boundary_values: 25
malicious_content: 25
structural_anomalies: 25

## Threshold
80
`;
      await writeFile(filePath, content, 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.passThreshold).toBe(80);
    });

    it('should default threshold to 100 when section is empty', async () => {
      const filePath = join(TEST_DIR, 'no-threshold.md');
      const content = `## Profile Distribution
happy_path: 25
boundary_values: 25
malicious_content: 25
structural_anomalies: 25
`;
      await writeFile(filePath, content, 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.passThreshold).toBe(100);
    });

    it('should accept threshold of 0', async () => {
      const filePath = join(TEST_DIR, 'zero-threshold.md');
      const content = `## Profile Distribution
happy_path: 25
boundary_values: 25
malicious_content: 25
structural_anomalies: 25

## Threshold
0
`;
      await writeFile(filePath, content, 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.passThreshold).toBe(0);
    });
  });

  describe('special instructions', () => {
    it('should extract unrecognized sections as special instructions', async () => {
      const filePath = join(TEST_DIR, 'special.md');
      const content = `## Profile Distribution
happy_path: 25
boundary_values: 25
malicious_content: 25
structural_anomalies: 25

## Custom Notes
Focus on testing the /chat endpoint with long conversations.
Make sure to test rate limiting scenarios.
`;
      await writeFile(filePath, content, 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.specialInstructions).toContain('Custom Notes');
      expect(result.specialInstructions).toContain('Focus on testing the /chat endpoint');
      expect(result.specialInstructions).toContain('rate limiting scenarios');
    });
  });

  describe('complete test plan', () => {
    it('should parse a full test plan with all sections', async () => {
      const filePath = join(TEST_DIR, 'complete.md');
      const content = `# Test Plan

## Profile Distribution
happy_path: 40
boundary_values: 20
malicious_content: 20
structural_anomalies: 20

## Scenario Sequences
- happy_path: Greet the bot
- malicious_content: Try XSS attack
- boundary_values: Send empty message

## Priority Areas
- Authentication
- Error handling

## Threshold
75

## Additional Context
Test the system under load conditions.
`;
      await writeFile(filePath, content, 'utf-8');

      const result = await parseTestPlan(filePath, 20);

      expect(result.profileDistribution.happy_path).toBe(40);
      expect(result.scenarioSequences).toHaveLength(3);
      expect(result.priorityAreas).toEqual(['Authentication', 'Error handling']);
      expect(result.passThreshold).toBe(75);
      expect(result.specialInstructions).toContain('Additional Context');
      expect(result.specialInstructions).toContain('load conditions');
    });
  });
});
