import type { ProfileAllocation, ProfileDistribution, ScenarioStep, InputProfile } from './types';

/** All four input profiles in a fixed order for round-robin allocation. */
const ALL_PROFILES: InputProfile[] = [
  'happy_path',
  'boundary_values',
  'malicious_content',
  'structural_anomalies',
];

/**
 * Pre-computes profile assignment for each turn based on distribution percentages
 * and scenario sequences.
 *
 * Algorithm:
 * 1. Place scenario sequence turns first (with isScenarioStep=true and scenarioContext).
 * 2. For remaining turns, allocate profiles according to the distribution percentages.
 * 3. When distribution is equal (25% each), use a round-robin pattern to guarantee
 *    the sliding window property (every 4 consecutive turns contain all 4 profiles).
 * 4. For non-equal distributions, use a weighted allocation that ensures each profile
 *    count is within ±1 of the expected count (percentage × totalTurns / 100).
 *
 * @param totalTurns - Total number of turns in the test suite
 * @param distribution - Profile distribution percentages (must sum to 100)
 * @param scenarioSequences - Ordered scenario steps to place first
 * @returns Array of ProfileAllocation objects for each turn
 */
export function allocateProfiles(
  totalTurns: number,
  distribution: ProfileDistribution,
  scenarioSequences: ScenarioStep[]
): ProfileAllocation[] {
  const allocations: ProfileAllocation[] = [];

  // Step 1: Place scenario sequence turns first
  for (let i = 0; i < scenarioSequences.length && i < totalTurns; i++) {
    const step = scenarioSequences[i];
    allocations.push({
      turnIndex: i,
      profile: step.profile,
      isScenarioStep: true,
      scenarioContext: step.description,
    });
  }

  // Step 2: Determine remaining turns to fill
  const remainingTurns = totalTurns - allocations.length;
  if (remainingTurns <= 0) {
    return allocations;
  }

  // Step 3: Determine if distribution is equal (25% each)
  const isEqualDistribution =
    distribution.happy_path === 25 &&
    distribution.boundary_values === 25 &&
    distribution.malicious_content === 25 &&
    distribution.structural_anomalies === 25;

  let remainingProfiles: InputProfile[];

  if (isEqualDistribution) {
    // Use round-robin to guarantee sliding window property
    remainingProfiles = allocateRoundRobin(remainingTurns, allocations);
  } else {
    // Use weighted allocation ensuring ±1 accuracy
    remainingProfiles = allocateWeighted(remainingTurns, distribution, totalTurns, allocations);
  }

  // Step 4: Append remaining allocations
  const startIndex = allocations.length;
  for (let i = 0; i < remainingProfiles.length; i++) {
    allocations.push({
      turnIndex: startIndex + i,
      profile: remainingProfiles[i],
      isScenarioStep: false,
    });
  }

  return allocations;
}

/**
 * Allocates profiles using round-robin pattern to guarantee the sliding window
 * property: every 4 consecutive turns contain all 4 profiles.
 *
 * Takes into account scenario steps already placed to maintain the window property
 * across the boundary between scenario steps and generated turns.
 */
function allocateRoundRobin(
  remainingTurns: number,
  existingAllocations: ProfileAllocation[]
): InputProfile[] {
  const result: InputProfile[] = [];

  // Determine the starting offset for round-robin based on existing allocations
  // We need to ensure the sliding window property holds across the full sequence
  const scenarioCount = existingAllocations.length;

  if (scenarioCount === 0) {
    // Simple case: pure round-robin from the start
    for (let i = 0; i < remainingTurns; i++) {
      result.push(ALL_PROFILES[i % 4]);
    }
  } else {
    // We need to continue round-robin considering the scenario steps
    // Start a fresh round-robin cycle for the remaining turns,
    // but offset to complement what's already been placed
    // Use modular offset based on scenario count to maintain diversity
    const offset = scenarioCount % 4;
    for (let i = 0; i < remainingTurns; i++) {
      result.push(ALL_PROFILES[(i + offset) % 4]);
    }
  }

  return result;
}

/**
 * Allocates profiles using weighted distribution ensuring each profile count
 * is within ±1 of the expected count (percentage × totalTurns / 100).
 *
 * Uses the largest remainder method (Hamilton's method) for fair apportionment.
 */
function allocateWeighted(
  remainingTurns: number,
  distribution: ProfileDistribution,
  totalTurns: number,
  existingAllocations: ProfileAllocation[]
): InputProfile[] {
  // Calculate target counts for the entire suite (totalTurns)
  const targetCounts = computeTargetCounts(distribution, totalTurns);

  // Subtract counts already used by scenario steps
  const scenarioCounts: Record<InputProfile, number> = {
    happy_path: 0,
    boundary_values: 0,
    malicious_content: 0,
    structural_anomalies: 0,
  };

  for (const alloc of existingAllocations) {
    scenarioCounts[alloc.profile]++;
  }

  // Remaining counts needed for each profile
  const neededCounts: Record<InputProfile, number> = {
    happy_path: Math.max(0, targetCounts.happy_path - scenarioCounts.happy_path),
    boundary_values: Math.max(0, targetCounts.boundary_values - scenarioCounts.boundary_values),
    malicious_content: Math.max(0, targetCounts.malicious_content - scenarioCounts.malicious_content),
    structural_anomalies: Math.max(0, targetCounts.structural_anomalies - scenarioCounts.structural_anomalies),
  };

  // Adjust if needed counts don't sum to remainingTurns
  let neededSum = neededCounts.happy_path + neededCounts.boundary_values +
    neededCounts.malicious_content + neededCounts.structural_anomalies;

  // If there's a discrepancy (due to scenario steps consuming more of one profile),
  // redistribute the difference proportionally
  if (neededSum !== remainingTurns) {
    const adjustedCounts = redistributeCounts(neededCounts, remainingTurns, distribution);
    neededCounts.happy_path = adjustedCounts.happy_path;
    neededCounts.boundary_values = adjustedCounts.boundary_values;
    neededCounts.malicious_content = adjustedCounts.malicious_content;
    neededCounts.structural_anomalies = adjustedCounts.structural_anomalies;
  }

  // Build the sequence by interleaving profiles for diversity
  return interleaveProfiles(neededCounts);
}

/**
 * Computes target counts for each profile using the largest remainder method.
 * This ensures each count is within ±1 of the ideal (percentage × total / 100).
 */
function computeTargetCounts(
  distribution: ProfileDistribution,
  totalTurns: number
): Record<InputProfile, number> {
  const profiles: InputProfile[] = ALL_PROFILES;
  const exactCounts = profiles.map((p) => (distribution[p] / 100) * totalTurns);
  const floorCounts = exactCounts.map((c) => Math.floor(c));
  const remainders = exactCounts.map((c, i) => c - floorCounts[i]);

  // Distribute remaining seats by largest remainder
  let allocated = floorCounts.reduce((sum, c) => sum + c, 0);
  let remaining = totalTurns - allocated;

  // Create indices sorted by remainder (descending)
  const indices = profiles.map((_, i) => i);
  indices.sort((a, b) => remainders[b] - remainders[a]);

  for (const idx of indices) {
    if (remaining <= 0) break;
    floorCounts[idx]++;
    remaining--;
  }

  const result: Record<InputProfile, number> = {
    happy_path: 0,
    boundary_values: 0,
    malicious_content: 0,
    structural_anomalies: 0,
  };

  for (let i = 0; i < profiles.length; i++) {
    result[profiles[i]] = floorCounts[i];
  }

  return result;
}

/**
 * Redistributes counts when scenario steps have caused a mismatch.
 * Uses the largest remainder method on the remaining turns.
 */
function redistributeCounts(
  currentCounts: Record<InputProfile, number>,
  targetTotal: number,
  distribution: ProfileDistribution
): Record<InputProfile, number> {
  // Recompute based on distribution applied to the remaining turns
  const profiles: InputProfile[] = ALL_PROFILES;
  const totalPercentage = profiles.reduce((sum, p) => sum + distribution[p], 0);

  const exactCounts = profiles.map((p) => (distribution[p] / totalPercentage) * targetTotal);
  const floorCounts = exactCounts.map((c) => Math.floor(c));
  const remainders = exactCounts.map((c, i) => c - floorCounts[i]);

  let allocated = floorCounts.reduce((sum, c) => sum + c, 0);
  let remaining = targetTotal - allocated;

  const indices = profiles.map((_, i) => i);
  indices.sort((a, b) => remainders[b] - remainders[a]);

  for (const idx of indices) {
    if (remaining <= 0) break;
    floorCounts[idx]++;
    remaining--;
  }

  const result: Record<InputProfile, number> = {
    happy_path: 0,
    boundary_values: 0,
    malicious_content: 0,
    structural_anomalies: 0,
  };

  for (let i = 0; i < profiles.length; i++) {
    result[profiles[i]] = floorCounts[i];
  }

  return result;
}

/**
 * Interleaves profiles to create a diverse sequence rather than grouping
 * all instances of one profile together.
 *
 * Uses a round-robin approach weighted by remaining count.
 */
function interleaveProfiles(counts: Record<InputProfile, number>): InputProfile[] {
  const result: InputProfile[] = [];
  const remaining = { ...counts };
  const totalTurns = ALL_PROFILES.reduce((sum, p) => sum + remaining[p], 0);

  for (let i = 0; i < totalTurns; i++) {
    // Pick the profile with the highest remaining proportion
    let bestProfile: InputProfile = ALL_PROFILES[0];
    let bestScore = -1;

    for (const profile of ALL_PROFILES) {
      if (remaining[profile] <= 0) continue;
      // Score = remaining count for this profile (higher = more urgently needed)
      const score = remaining[profile];
      if (score > bestScore) {
        bestScore = score;
        bestProfile = profile;
      }
    }

    result.push(bestProfile);
    remaining[bestProfile]--;
  }

  return result;
}
