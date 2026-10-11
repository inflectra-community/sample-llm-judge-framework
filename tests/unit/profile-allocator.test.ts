import { describe, it, expect } from 'vitest';
import { allocateProfiles } from '../../src/profile-allocator';
import type { ProfileDistribution, ScenarioStep, InputProfile } from '../../src/types';

const EQUAL_DISTRIBUTION: ProfileDistribution = {
  happy_path: 25,
  boundary_values: 25,
  malicious_content: 25,
  structural_anomalies: 25,
};

const ALL_PROFILES: InputProfile[] = [
  'happy_path',
  'boundary_values',
  'malicious_content',
  'structural_anomalies',
];

describe('allocateProfiles', () => {
  describe('basic allocation', () => {
    it('should return correct number of allocations', () => {
      const result = allocateProfiles(10, EQUAL_DISTRIBUTION, []);
      expect(result).toHaveLength(10);
    });

    it('should assign sequential turnIndex values', () => {
      const result = allocateProfiles(8, EQUAL_DISTRIBUTION, []);
      for (let i = 0; i < result.length; i++) {
        expect(result[i].turnIndex).toBe(i);
      }
    });

    it('should mark all turns as non-scenario when no scenarios provided', () => {
      const result = allocateProfiles(8, EQUAL_DISTRIBUTION, []);
      for (const alloc of result) {
        expect(alloc.isScenarioStep).toBe(false);
        expect(alloc.scenarioContext).toBeUndefined();
      }
    });
  });

  describe('scenario sequence placement', () => {
    it('should place scenario steps first', () => {
      const scenarios: ScenarioStep[] = [
        { profile: 'malicious_content', description: 'SQL injection test' },
        { profile: 'happy_path', description: 'Normal greeting' },
      ];

      const result = allocateProfiles(10, EQUAL_DISTRIBUTION, scenarios);

      expect(result[0].profile).toBe('malicious_content');
      expect(result[0].isScenarioStep).toBe(true);
      expect(result[0].scenarioContext).toBe('SQL injection test');

      expect(result[1].profile).toBe('happy_path');
      expect(result[1].isScenarioStep).toBe(true);
      expect(result[1].scenarioContext).toBe('Normal greeting');
    });

    it('should count scenario steps toward total turns', () => {
      const scenarios: ScenarioStep[] = [
        { profile: 'happy_path', description: 'Step 1' },
        { profile: 'boundary_values', description: 'Step 2' },
      ];

      const result = allocateProfiles(5, EQUAL_DISTRIBUTION, scenarios);
      expect(result).toHaveLength(5);
    });

    it('should handle scenario steps filling all turns', () => {
      const scenarios: ScenarioStep[] = [
        { profile: 'happy_path', description: 'Step 1' },
        { profile: 'boundary_values', description: 'Step 2' },
        { profile: 'malicious_content', description: 'Step 3' },
      ];

      const result = allocateProfiles(3, EQUAL_DISTRIBUTION, scenarios);
      expect(result).toHaveLength(3);
      expect(result.every((a) => a.isScenarioStep)).toBe(true);
    });
  });

  describe('equal distribution - sliding window property', () => {
    it('should contain all 4 profiles in every window of 4 consecutive turns (8 turns)', () => {
      const result = allocateProfiles(8, EQUAL_DISTRIBUTION, []);

      for (let i = 0; i <= result.length - 4; i++) {
        const window = result.slice(i, i + 4).map((a) => a.profile);
        const uniqueProfiles = new Set(window);
        expect(uniqueProfiles.size).toBe(4);
      }
    });

    it('should contain all 4 profiles in every window of 4 consecutive turns (12 turns)', () => {
      const result = allocateProfiles(12, EQUAL_DISTRIBUTION, []);

      for (let i = 0; i <= result.length - 4; i++) {
        const window = result.slice(i, i + 4).map((a) => a.profile);
        const uniqueProfiles = new Set(window);
        expect(uniqueProfiles.size).toBe(4);
      }
    });

    it('should contain all 4 profiles in every window of 4 (exactly 4 turns)', () => {
      const result = allocateProfiles(4, EQUAL_DISTRIBUTION, []);

      const profiles = result.map((a) => a.profile);
      const uniqueProfiles = new Set(profiles);
      expect(uniqueProfiles.size).toBe(4);
    });

    it('should have equal counts for 8 turns with equal distribution', () => {
      const result = allocateProfiles(8, EQUAL_DISTRIBUTION, []);
      const counts: Record<string, number> = {};
      for (const alloc of result) {
        counts[alloc.profile] = (counts[alloc.profile] || 0) + 1;
      }
      for (const profile of ALL_PROFILES) {
        expect(counts[profile]).toBe(2);
      }
    });
  });

  describe('non-equal distribution - ±1 accuracy', () => {
    it('should allocate within ±1 of expected count (50/20/20/10)', () => {
      const distribution: ProfileDistribution = {
        happy_path: 50,
        boundary_values: 20,
        malicious_content: 20,
        structural_anomalies: 10,
      };

      const result = allocateProfiles(20, distribution, []);

      const counts: Record<string, number> = {};
      for (const alloc of result) {
        counts[alloc.profile] = (counts[alloc.profile] || 0) + 1;
      }

      // Expected: happy_path=10, boundary=4, malicious=4, structural=2
      expect(counts['happy_path']).toBeGreaterThanOrEqual(9);
      expect(counts['happy_path']).toBeLessThanOrEqual(11);
      expect(counts['boundary_values']).toBeGreaterThanOrEqual(3);
      expect(counts['boundary_values']).toBeLessThanOrEqual(5);
      expect(counts['malicious_content']).toBeGreaterThanOrEqual(3);
      expect(counts['malicious_content']).toBeLessThanOrEqual(5);
      expect(counts['structural_anomalies']).toBeGreaterThanOrEqual(1);
      expect(counts['structural_anomalies']).toBeLessThanOrEqual(3);
    });

    it('should allocate within ±1 of expected count (70/10/10/10)', () => {
      const distribution: ProfileDistribution = {
        happy_path: 70,
        boundary_values: 10,
        malicious_content: 10,
        structural_anomalies: 10,
      };

      const result = allocateProfiles(10, distribution, []);

      const counts: Record<string, number> = {};
      for (const alloc of result) {
        counts[alloc.profile] = (counts[alloc.profile] || 0) + 1;
      }

      // Expected: happy_path=7, boundary=1, malicious=1, structural=1
      expect(counts['happy_path']).toBeGreaterThanOrEqual(6);
      expect(counts['happy_path']).toBeLessThanOrEqual(8);
      expect(counts['boundary_values'] || 0).toBeGreaterThanOrEqual(0);
      expect(counts['boundary_values'] || 0).toBeLessThanOrEqual(2);
      expect(counts['malicious_content'] || 0).toBeGreaterThanOrEqual(0);
      expect(counts['malicious_content'] || 0).toBeLessThanOrEqual(2);
      expect(counts['structural_anomalies'] || 0).toBeGreaterThanOrEqual(0);
      expect(counts['structural_anomalies'] || 0).toBeLessThanOrEqual(2);
    });

    it('should handle 0% allocation for a profile', () => {
      const distribution: ProfileDistribution = {
        happy_path: 50,
        boundary_values: 50,
        malicious_content: 0,
        structural_anomalies: 0,
      };

      const result = allocateProfiles(10, distribution, []);

      const counts: Record<string, number> = {};
      for (const alloc of result) {
        counts[alloc.profile] = (counts[alloc.profile] || 0) + 1;
      }

      expect(counts['malicious_content'] || 0).toBe(0);
      expect(counts['structural_anomalies'] || 0).toBe(0);
      expect(counts['happy_path']).toBe(5);
      expect(counts['boundary_values']).toBe(5);
    });
  });

  describe('scenario steps with distribution', () => {
    it('should account for scenario step profiles in distribution counts', () => {
      const scenarios: ScenarioStep[] = [
        { profile: 'happy_path', description: 'Greeting' },
        { profile: 'happy_path', description: 'Follow-up' },
      ];

      const distribution: ProfileDistribution = {
        happy_path: 50,
        boundary_values: 20,
        malicious_content: 20,
        structural_anomalies: 10,
      };

      const result = allocateProfiles(10, distribution, scenarios);
      expect(result).toHaveLength(10);

      // All turns should have valid profiles
      for (const alloc of result) {
        expect(ALL_PROFILES).toContain(alloc.profile);
      }
    });
  });
});
