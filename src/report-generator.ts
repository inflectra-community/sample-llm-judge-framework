/**
 * Report Generator module for the Dynamic Multi-Agent Chatbot REST API Tester.
 *
 * Aggregates TestTurnResults into a structured Markdown Summary Report with:
 * - Overall statistics (total, pass, fail, pass rate)
 * - Failure breakdown by category
 * - Results breakdown by InputProfile
 * - Individual failed turn details
 * - Error section grouped by phase
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 8.4
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  TestSuiteResult,
  TestPlan,
  TestTurnResult,
  FailureCategory,
  InputProfile,
} from './types';

/** Profile display names mapping. */
const PROFILE_DISPLAY_NAMES: Record<InputProfile, string> = {
  happy_path: 'Happy Path',
  boundary_values: 'Boundary Values',
  malicious_content: 'Malicious Content',
  structural_anomalies: 'Structural Anomalies',
};

/** All failure categories (excluding NONE). */
const FAILURE_CATEGORIES: FailureCategory[] = [
  'SCHEMA_VIOLATION',
  'UNHANDLED_EXCEPTION',
  'LOGIC_ERROR',
  'SECURITY_RISK',
  'PERFORMANCE_ISSUE',
];

/** All input profiles. */
const ALL_PROFILES: InputProfile[] = [
  'happy_path',
  'boundary_values',
  'malicious_content',
  'structural_anomalies',
];

/**
 * Formats a Date as YYYYMMDDTHHMMSS in UTC.
 */
export function formatTimestamp(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  const h = date.getUTCHours().toString().padStart(2, '0');
  const min = date.getUTCMinutes().toString().padStart(2, '0');
  const s = date.getUTCSeconds().toString().padStart(2, '0');
  return `${y}${m}${d}T${h}${min}${s}`;
}

/**
 * Generates the Markdown report content from suite results and test plan.
 */
export function generateReport(suiteResult: TestSuiteResult, testPlan: TestPlan, verbose: boolean = false): string {
  const { turns } = suiteResult;
  const lines: string[] = [];

  // Header
  lines.push('# Test Suite Summary Report');
  lines.push('');

  // Overall Statistics
  const passedTurns = turns.filter((t) => t.status === 'passed');
  const failedTurns = turns.filter((t) => t.status === 'failed');
  const skippedOrErrored = turns.filter(
    (t) => t.status === 'skipped' || t.status === 'execution_error' || t.status === 'evaluation_error'
  );

  const totalCount = turns.length;
  const passCount = passedTurns.length;
  const failCount = failedTurns.length;
  const totalExecuted = passCount + failCount;
  const passRate = totalExecuted > 0 ? ((passCount / totalExecuted) * 100).toFixed(1) : '0.0';

  lines.push('## Overall Statistics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total Tests | ${totalCount} |`);
  lines.push(`| Passed | ${passCount} |`);
  lines.push(`| Failed | ${failCount} |`);
  lines.push(`| Skipped/Errored | ${skippedOrErrored.length} |`);
  lines.push(`| Pass Rate | ${passRate}% |`);
  lines.push('');

  // Failure Breakdown by Category
  lines.push('## Failure Breakdown by Category');
  lines.push('');
  lines.push(`| Category | Count |`);
  lines.push(`| --- | --- |`);

  for (const category of FAILURE_CATEGORIES) {
    const count = failedTurns.filter(
      (t) => t.verdict?.failureCategory === category
    ).length;
    lines.push(`| ${category} | ${count} |`);
  }
  lines.push('');

  // Results by Input Profile
  lines.push('## Results by Input Profile');
  lines.push('');
  lines.push(`| Profile | Passed | Failed | Fail Rate |`);
  lines.push(`| --- | --- | --- | --- |`);

  for (const profile of ALL_PROFILES) {
    const profileTurns = turns.filter((t) => t.profile === profile);
    const profilePassed = profileTurns.filter((t) => t.status === 'passed').length;
    const profileFailed = profileTurns.filter((t) => t.status === 'failed').length;
    const profileExecuted = profilePassed + profileFailed;
    const profileFailRate =
      profileExecuted > 0 ? ((profileFailed / profileExecuted) * 100).toFixed(1) : '0.0';
    lines.push(
      `| ${PROFILE_DISPLAY_NAMES[profile]} | ${profilePassed} | ${profileFailed} | ${profileFailRate}% |`
    );
  }
  lines.push('');

  // Turn Details
  const turnsToDetail = verbose ? turns : failedTurns;
  const sectionTitle = verbose ? '## All Test Details' : '## Failed Test Details';

  if (turnsToDetail.length > 0) {
    lines.push(sectionTitle);
    lines.push('');

    for (const turn of turnsToDetail) {
      const statusBadge = turn.status === 'passed' ? '✅' : turn.status === 'failed' ? '❌' : '⚠️';
      lines.push(`### ${statusBadge} ${turn.turnId} (${turn.status})`);
      lines.push('');
      if (turn.verdict?.failureCategory && turn.verdict.failureCategory !== 'NONE') {
        lines.push(`**Failure Category:** ${turn.verdict.failureCategory}`);
        lines.push('');
      }
      lines.push('**Original Input:**');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(turn.input?.payload ?? null, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('**API Response:**');
      lines.push('');
      lines.push('```json');
      lines.push(
        JSON.stringify(
          turn.response
            ? { statusCode: turn.response.statusCode, body: turn.response.body }
            : null,
          null,
          2
        )
      );
      lines.push('```');
      lines.push('');

      if (turn.verdict?.assertions && turn.verdict.assertions.length > 0) {
        lines.push('**Assertions:**');
        lines.push('');
        lines.push(`| Check | Status | Details |`);
        lines.push(`| --- | --- | --- |`);
        for (const assertion of turn.verdict.assertions) {
          lines.push(`| ${assertion.check} | ${assertion.status} | ${assertion.details} |`);
        }
        lines.push('');
      }
    }
  } else {
    lines.push('## Result');
    lines.push('');
    lines.push('✅ All tests passed! No failures detected.');
    lines.push('');
  }

  // Error Section: group skipped/errored turns by phase
  if (skippedOrErrored.length > 0) {
    lines.push('## Errors and Skipped Turns');
    lines.push('');

    const phases: Array<'input_generation' | 'api_execution' | 'evaluation'> = [
      'input_generation',
      'api_execution',
      'evaluation',
    ];

    const phaseDisplayNames: Record<string, string> = {
      input_generation: 'Input Generation',
      api_execution: 'API Execution',
      evaluation: 'Evaluation',
    };

    for (const phase of phases) {
      const phaseTurns = skippedOrErrored.filter((t) => t.error?.phase === phase);
      if (phaseTurns.length === 0) continue;

      lines.push(`### ${phaseDisplayNames[phase]}`);
      lines.push('');
      lines.push(`| Turn ID | Phase | Error Type | Message |`);
      lines.push(`| --- | --- | --- | --- |`);

      for (const turn of phaseTurns) {
        const errorType = turn.error?.type ?? 'unknown';
        const errorMessage = turn.error?.message ?? 'No message';
        lines.push(`| ${turn.turnId} | ${phase} | ${errorType} | ${errorMessage} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Writes the report content to a file and returns the file path.
 * Filename format: summary_report_YYYYMMDDTHHMMSS.md
 */
export function writeReport(report: string, outputDir: string, startTime: Date): string {
  const timestamp = formatTimestamp(startTime);
  const filename = `summary_report_${timestamp}.md`;
  const filePath = path.join(outputDir, filename);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(filePath, report, 'utf-8');
  return filePath;
}
