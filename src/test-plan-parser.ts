import { loadSteeringFile, SteeringFileError } from './steering-loader';
import type { TestPlan, ProfileDistribution, ScenarioStep, InputProfile } from './types';

/**
 * Custom error class for test plan validation failures.
 */
export class TestPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestPlanError';
  }
}

/** Valid input profile keys. */
const VALID_PROFILES: InputProfile[] = [
  'happy_path',
  'boundary_values',
  'malicious_content',
  'structural_anomalies',
];

/** Default test plan used when the file is missing, empty, or whitespace-only. */
function getDefaultTestPlan(): TestPlan {
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

/**
 * Parses a test plan markdown file and returns a validated TestPlan object.
 *
 * The file is expected to have sections:
 * - `## Profile Distribution` with lines like `happy_path: 30`
 * - `## Scenario Sequences` with ordered steps like `- happy_path: Description text`
 * - `## Priority Areas` with bullet points
 * - `## Threshold` with a single integer
 * - Any other content is treated as special instructions
 *
 * @param filePath - Path to the test-plan.md file
 * @param totalTurnCount - Total number of turns configured for the test suite
 * @returns Parsed and validated TestPlan
 * @throws {TestPlanError} If the file contains invalid distribution, overflow scenarios, etc.
 */
export async function parseTestPlan(filePath: string, totalTurnCount: number): Promise<TestPlan> {
  let content: string;

  try {
    content = await loadSteeringFile(filePath);
  } catch (error) {
    // If file is missing, empty, or whitespace-only, fall back to defaults
    if (error instanceof SteeringFileError) {
      return getDefaultTestPlan();
    }
    // Re-throw unexpected errors
    return getDefaultTestPlan();
  }

  return parseTestPlanContent(content, totalTurnCount);
}

/**
 * Parses the raw markdown content of a test plan file.
 */
function parseTestPlanContent(content: string, totalTurnCount: number): TestPlan {
  const sections = parseSections(content);

  const profileDistribution = parseProfileDistribution(sections.profileDistribution);
  const scenarioSequences = parseScenarioSequences(sections.scenarioSequences);
  const priorityAreas = parsePriorityAreas(sections.priorityAreas);
  const passThreshold = parseThreshold(sections.threshold);
  const specialInstructions = sections.specialInstructions.trim();

  // Validate scenario sequence length against total turn count
  if (scenarioSequences.length > totalTurnCount) {
    throw new TestPlanError(
      `Scenario sequence length (${scenarioSequences.length}) exceeds the available turn count (${totalTurnCount})`
    );
  }

  return {
    profileDistribution,
    scenarioSequences,
    priorityAreas,
    passThreshold,
    specialInstructions,
  };
}

interface ParsedSections {
  profileDistribution: string;
  scenarioSequences: string;
  priorityAreas: string;
  threshold: string;
  specialInstructions: string;
}

/**
 * Splits the markdown content into recognized sections.
 * Any content not in a recognized section is collected as special instructions.
 */
function parseSections(content: string): ParsedSections {
  const sections: ParsedSections = {
    profileDistribution: '',
    scenarioSequences: '',
    priorityAreas: '',
    threshold: '',
    specialInstructions: '',
  };

  const lines = content.split(/\r?\n/);
  let currentSection: keyof ParsedSections | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)$/);
    if (headerMatch) {
      const headerName = headerMatch[1].trim().toLowerCase();
      if (headerName === 'profile distribution') {
        currentSection = 'profileDistribution';
      } else if (headerName === 'scenario sequences') {
        currentSection = 'scenarioSequences';
      } else if (headerName === 'priority areas') {
        currentSection = 'priorityAreas';
      } else if (headerName === 'threshold') {
        currentSection = 'threshold';
      } else {
        // Unrecognized section header → special instructions
        currentSection = 'specialInstructions';
        sections.specialInstructions += line + '\n';
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection] += line + '\n';
    } else {
      // Content before any section header → special instructions
      // Skip top-level headers (# Title)
      if (line.match(/^#\s+/) || line.trim() === '') {
        continue;
      }
      sections.specialInstructions += line + '\n';
    }
  }

  return sections;
}

/**
 * Parses the Profile Distribution section.
 * Expected format: lines like `happy_path: 30`
 */
function parseProfileDistribution(sectionContent: string): ProfileDistribution {
  const lines = sectionContent.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    // No distribution specified, use defaults
    return {
      happy_path: 25,
      boundary_values: 25,
      malicious_content: 25,
      structural_anomalies: 25,
    };
  }

  const distribution: Partial<ProfileDistribution> = {};

  for (const line of lines) {
    const match = line.match(/^\s*(\w+)\s*:\s*(\d+)\s*$/);
    if (!match) {
      continue;
    }

    const profile = match[1] as InputProfile;
    const value = parseInt(match[2], 10);

    if (!VALID_PROFILES.includes(profile)) {
      continue;
    }

    if (value < 0 || value > 100) {
      throw new TestPlanError(
        `Invalid profile distribution: ${profile} has value ${value}, must be between 0 and 100`
      );
    }

    distribution[profile] = value;
  }

  // Fill in missing profiles with 0 if some were specified
  const result: ProfileDistribution = {
    happy_path: distribution.happy_path ?? 0,
    boundary_values: distribution.boundary_values ?? 0,
    malicious_content: distribution.malicious_content ?? 0,
    structural_anomalies: distribution.structural_anomalies ?? 0,
  };

  // Validate sum
  const sum = result.happy_path + result.boundary_values + result.malicious_content + result.structural_anomalies;
  if (sum !== 100) {
    throw new TestPlanError(
      `Profile distribution percentages must sum to 100, but got ${sum}`
    );
  }

  return result;
}

/**
 * Parses the Scenario Sequences section.
 * Expected format: lines like `- happy_path: Description text`
 */
function parseScenarioSequences(sectionContent: string): ScenarioStep[] {
  const lines = sectionContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const steps: ScenarioStep[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*-\s+(\w+)\s*:\s*(.+)$/);
    if (!match) {
      continue;
    }

    const profile = match[1] as InputProfile;
    const description = match[2].trim();

    if (!VALID_PROFILES.includes(profile)) {
      continue;
    }

    steps.push({ profile, description });
  }

  return steps;
}

/**
 * Parses the Priority Areas section.
 * Expected format: bullet points like `- Area description`
 */
function parsePriorityAreas(sectionContent: string): string[] {
  const lines = sectionContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const areas: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) {
      areas.push(match[1].trim());
    }
  }

  return areas;
}

/**
 * Parses the Threshold section.
 * Expected format: a single integer 0-100.
 */
function parseThreshold(sectionContent: string): number {
  const trimmed = sectionContent.trim();

  if (trimmed.length === 0) {
    return 100; // Default threshold
  }

  const match = trimmed.match(/^(\d+)$/);
  if (!match) {
    return 100; // Default if not a valid integer
  }

  const value = parseInt(match[1], 10);

  if (value < 0 || value > 100) {
    throw new TestPlanError(
      `Pass/fail threshold must be between 0 and 100, but got ${value}`
    );
  }

  return value;
}
