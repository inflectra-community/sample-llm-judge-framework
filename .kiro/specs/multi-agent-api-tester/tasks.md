# Implementation Plan: Dynamic Multi-Agent Chatbot REST API Tester

## Overview

This plan implements a Node.js/TypeScript CLI tool that stress-tests a Chatbot REST API using an Orchestrator pattern with specialized LLM-backed sub-agents (Input_Generator and Judge_Evaluator) steered by markdown persona files. The implementation follows an incremental approach: core infrastructure first, then individual components, then wiring and integration.

## Tasks

- [x] 1. Set up project structure and core interfaces
  - [x] 1.1 Initialize Node.js/TypeScript project with dependencies
    - Initialize package.json with TypeScript, ts-node, vitest, fast-check, commander (CLI), and node-fetch/undici
    - Create tsconfig.json with strict mode enabled
    - Create directory structure: src/, src/agents/, tests/unit/, tests/property/, tests/integration/
    - _Requirements: 6.1, 6.4_

  - [x] 1.2 Define core TypeScript interfaces and types
    - Create `src/types.ts` with all shared interfaces: CLIOptions, ResolvedConfig, InputProfile, GeneratedInput, APIResponse, Verdict, Assertion, FailureCategory, TestTurnResult, TurnStatus, TurnError, TestSuiteResult, ProfileAllocation, ProfileDistribution, TestPlan, ScenarioStep, APIContract, RequestSchema, ResponseSchema, FieldDefinition
    - _Requirements: 1.1, 2.1, 3.2, 4.4, 5.3, 6.1_

- [x] 2. Implement Configuration Manager
  - [x] 2.1 Implement configuration resolution and validation (`src/config.ts`)
    - Parse CLI arguments (endpoint, turns, timeout, mode, concurrency, contractPath) using commander
    - Read environment variables (API_TEST_ENDPOINT, API_TEST_TURNS, API_TEST_TIMEOUT, API_TEST_MODE, API_TEST_CONCURRENCY, API_TEST_CONTRACT)
    - Implement precedence: CLI args override environment variables
    - Validate endpoint is a valid HTTP(S) URL (required)
    - Validate turns is integer in [1, 1000], default 5
    - Validate timeout is integer in [1, 300], default 30
    - Validate mode is "sequential" or "concurrent", default "sequential"
    - Validate concurrency is integer in [1, 100], default 5
    - Exit with non-zero code and descriptive error for missing required params or invalid values
    - _Requirements: 1.1, 1.2, 1.3, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 2.2 Write property test for configuration validation
    - **Property 1: Configuration validation accepts valid inputs and rejects invalid inputs**
    - **Validates: Requirements 1.1, 1.3, 6.1, 6.2, 6.4, 6.5**

  - [ ]* 2.3 Write unit tests for configuration defaults and error messages
    - Test default values (turns=5, timeout=30, mode=sequential, concurrency=5)
    - Test missing endpoint produces error naming "endpoint"
    - Test invalid range values produce errors naming the parameter and valid range
    - _Requirements: 6.1, 6.3, 6.5_

- [x] 3. Implement Steering File Loader
  - [x] 3.1 Implement steering file loader (`src/steering-loader.ts`)
    - Read file content from given path
    - Reject with error if file not found or unreadable (include file path in error)
    - Reject with error if file is empty or whitespace-only (include file path in error)
    - Return full text content on success
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 3.2 Write property test for whitespace-only content rejection
    - **Property 14: Whitespace-only content treated as empty**
    - **Validates: Requirements 7.4, 9.9**

  - [ ]* 3.3 Write unit tests for steering file loader
    - Test file not found error includes path
    - Test empty file error
    - Test successful load returns content
    - _Requirements: 7.3, 7.4_

- [x] 4. Implement API Contract Loader
  - [x] 4.1 Implement contract loader (`src/contract-loader.ts`)
    - Read file from configured path (default: ./api-contract.json)
    - Reject files exceeding 10 MB with error indicating size limit
    - Reject if file not found or unreadable with error naming expected path
    - Parse JSON; reject invalid JSON with parse failure description
    - Detect format: "openapi" key → OpenAPI 3.x, "$schema" key → JSON Schema Draft 7+
    - Reject if neither key present with error
    - Validate required sections: request fields with types, required headers, success status codes, response body structure, error format
    - Return parsed APIContract object
    - _Requirements: 10.1, 10.2, 10.3, 10.6_

  - [ ]* 4.2 Write property test for contract format detection
    - **Property 12: Contract format detection and required section validation**
    - **Validates: Requirements 10.3, 10.6**

  - [ ]* 4.3 Write property test for extra fields permitted
    - **Property 13: Schema validation permits extra fields**
    - **Validates: Requirements 10.8**

  - [ ]* 4.4 Write unit tests for contract loader
    - Test file >10MB rejection
    - Test invalid JSON error message
    - Test missing format key rejection
    - Test valid OpenAPI detection
    - Test valid JSON Schema detection
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Test Plan Parser
  - [x] 6.1 Implement test plan parser (`src/test-plan-parser.ts`)
    - Attempt to read .kiro/steering/test-plan.md
    - If file missing, empty, or whitespace-only: fall back to defaults (25% each profile, 100% threshold)
    - Parse profile distribution directives (four integers 0-100 summing to 100)
    - Reject if percentages don't sum to 100 or any is outside [0, 100]
    - Parse scenario sequences (ordered steps with profile and description)
    - Reject if scenario sequence length exceeds total turn count
    - Parse priority areas as string directives
    - Parse pass/fail threshold (integer 0-100, default 100)
    - Extract special instructions (unrecognized directives) as supplemental context
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

  - [x] 6.2 Implement profile allocation algorithm
    - Pre-compute profile assignment for each turn based on distribution percentages
    - Place scenario sequence turns first, counting toward total
    - Ensure sliding window of 4 consecutive turns contains all 4 profiles (when equal distribution)
    - Ensure proportions are within ±1 turn of expected count
    - _Requirements: 2.2, 9.2, 9.3_

  - [ ]* 6.3 Write property test for profile rotation guarantee
    - **Property 2: Profile rotation guarantees all profiles in every window of four**
    - **Validates: Requirements 2.2**

  - [ ]* 6.4 Write property test for profile allocation matching distribution
    - **Property 9: Profile allocation matches configured distribution**
    - **Validates: Requirements 9.2, 9.3**

  - [ ]* 6.5 Write property test for test plan validation
    - **Property 11: Test plan validation rejects invalid distributions and overflow scenarios**
    - **Validates: Requirements 9.7, 9.10**

  - [ ]* 6.6 Write unit tests for test plan parser
    - Test fallback to defaults when file missing
    - Test fallback when file is whitespace-only
    - Test valid distribution parsing
    - Test scenario sequence parsing
    - _Requirements: 9.1, 9.6, 9.9_

- [ ] 7. Implement API Executor
  - [x] 7.1 Implement API executor (`src/api-executor.ts`)
    - Send HTTP POST with Content-Type application/json to configured endpoint /chat
    - Capture full response: status code, headers, body, latency
    - Handle timeout (configurable, default 30s): record as timeout failure
    - Handle connection errors (refused, DNS, TLS): record as connection failure
    - Handle non-2xx responses: record full response and continue
    - Implement sequential execution mode (one at a time, wait for each)
    - Implement concurrent execution mode with configurable concurrency limit (default 5, max 50)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 7.2 Write unit tests for API executor
    - Test timeout handling marks turn as execution_error
    - Test connection refused handling
    - Test non-2xx response captured correctly
    - Test concurrent mode respects concurrency limit
    - _Requirements: 3.3, 3.4, 3.5, 3.6_

- [x] 8. Implement Input Generator Agent
  - [x] 8.1 Implement Input Generator agent (`src/agents/input-generator.ts`)
    - Initialize with steering file content, API contract context, and test plan context
    - Accept profile assignment and turn index
    - Generate payloads conforming to the assigned InputProfile
    - Happy Path: produce schema-conforming payloads per API contract
    - Boundary Values: extreme numbers (0, -1, MAX_INT, MIN_INT), empty strings, 10000+ char strings, null params
    - Malicious Content: SQL injection, XSS scripts, null bytes, control chars, emoji combos
    - Structural Anomalies: missing required keys, malformed JSON, incorrect content-type
    - Output raw payload data only (JSON or plain-text), no conversational prose
    - Return GeneratedInput with payload, profile, contentType, and metadata
    - Handle LLM failures gracefully (return error indication)
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 10.4, 10.7_

  - [ ]* 8.2 Write unit tests for Input Generator
    - Test steering file content is passed as persona directive
    - Test API contract context is provided
    - Test error indication on steering file load failure
    - _Requirements: 2.3, 2.4, 10.4_

- [x] 9. Implement Judge Evaluator Agent
  - [x] 9.1 Implement Judge Evaluator agent (`src/agents/judge-evaluator.ts`)
    - Initialize with steering file content and API contract context
    - Accept input, API response, and turn ID
    - Evaluate against four criteria: Schema/Contract Fidelity, Boundary/Logic Correctness, State/Side-Effects, Performance Safety
    - Validate response against API contract schema (missing fields, wrong types, unexpected status codes, structure mismatch)
    - Extra fields not in contract SHALL NOT be treated as violations
    - Produce Verdict JSON: testId, verdict (PASSED/FAILED), confidenceScore (0.0-1.0), failureCategory, summary (1-200 chars), assertions (1-50 entries)
    - PASSED → failureCategory = NONE; FAILED → one of SCHEMA_VIOLATION, UNHANDLED_EXCEPTION, LOGIC_ERROR, SECURITY_RISK, PERFORMANCE_ISSUE
    - Handle malformed/unparseable API response: produce FAILED/UNHANDLED_EXCEPTION verdict
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 10.5, 10.8_

  - [ ]* 9.2 Write property test for verdict structure invariant
    - **Property 3: Verdict structure invariant**
    - **Validates: Requirements 4.4, 4.6**

  - [ ]* 9.3 Write unit tests for Judge Evaluator
    - Test malformed response produces FAILED/UNHANDLED_EXCEPTION
    - Test steering file content passed as persona directive
    - Test API contract context provided for schema validation
    - _Requirements: 4.2, 4.7, 10.5_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Report Generator
  - [x] 11.1 Implement report generator (`src/report-generator.ts`)
    - Aggregate all TestTurnResults into Markdown Summary_Report
    - Sections in order: overall statistics, failure breakdown by failureCategory, results by InputProfile, individual failed turn details
    - Overall stats: total count, pass count, fail count, pass rate (percentage, 1 decimal place)
    - Failure breakdown: counts grouped by SCHEMA_VIOLATION, UNHANDLED_EXCEPTION, LOGIC_ERROR, SECURITY_RISK, PERFORMANCE_ISSUE
    - Profile breakdown: pass count, fail count, fail rate per profile (Happy Path, Boundary Values, Malicious Content, Structural Anomalies)
    - Failed turn details: testId, original input, API response, failureCategory, assertions
    - If zero failures: omit failed details section, display all-pass message
    - Error section: group skipped/errored turns by phase (input_generation, api_execution, evaluation) with turn ID, phase, error type/message
    - Write report to `summary_report_<YYYYMMDDTHHMMSS>.md` in output directory
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 8.4_

  - [ ]* 11.2 Write property test for report statistics correctness
    - **Property 4: Report statistics correctness**
    - **Validates: Requirements 5.3, 5.4**

  - [ ]* 11.3 Write property test for failed turn inclusion
    - **Property 5: Report includes all failed turn details**
    - **Validates: Requirements 5.5**

  - [ ]* 11.4 Write property test for report filename timestamp format
    - **Property 6: Report filename timestamp format**
    - **Validates: Requirements 5.7**

  - [ ]* 11.5 Write property test for error report grouping
    - **Property 8: Error report grouping by phase**
    - **Validates: Requirements 8.4**

  - [ ]* 11.6 Write unit tests for report generator
    - Test all-pass report omits failed details section
    - Test pass rate rounded to 1 decimal place
    - Test profile breakdown sums match totals
    - _Requirements: 5.3, 5.4, 5.6_

- [x] 12. Implement Orchestrator
  - [x] 12.1 Implement Orchestrator core (`src/orchestrator.ts`)
    - Initialize with ResolvedConfig
    - Load steering files (input-agent.md, judge-agent.md) via SteeringLoader
    - Load API contract via ContractLoader
    - Load and parse test plan via TestPlanParser
    - Compute profile allocation for all turns
    - Pass test plan priority areas and special instructions to Input_Generator
    - Pass special instructions to Judge_Evaluator
    - Execute test suite lifecycle: for each turn → generate input → call API → evaluate → record
    - Support sequential mode (one turn at a time)
    - Support concurrent mode (parallel up to concurrency limit)
    - Implement error isolation: catch per-turn errors at each phase boundary
    - Mark input generation errors as "skipped"
    - Mark API execution errors as "execution_error"
    - Mark evaluation errors as "evaluation_error"
    - Log errors with turn ID, phase, error type, message, timestamp
    - Continue to next turn after any per-turn error
    - After all turns: aggregate results, generate report, write to file
    - Determine exit code based on pass rate vs threshold
    - _Requirements: 1.1, 1.4, 2.2, 3.1, 4.1, 7.1, 7.2, 8.1, 8.2, 8.3, 9.3, 9.4, 9.5, 9.8_

  - [ ]* 12.2 Write property test for error isolation and suite continuation
    - **Property 7: Error isolation and suite continuation**
    - **Validates: Requirements 8.1, 8.2, 8.3**

  - [ ]* 12.3 Write property test for pass rate threshold exit code
    - **Property 10: Pass rate threshold determines exit code**
    - **Validates: Requirements 9.5**

  - [ ]* 12.4 Write unit tests for Orchestrator
    - Test full lifecycle without further user interaction
    - Test sequential execution waits for each turn
    - Test concurrent execution respects limit
    - _Requirements: 1.4, 3.6, 3.7_

- [x] 13. Implement CLI Entry Point
  - [x] 13.1 Implement CLI entry point (`src/cli.ts`)
    - Parse command-line arguments using commander: --endpoint, --turns, --timeout, --mode, --concurrency, --contract-path
    - Map environment variables as fallback
    - Invoke Configuration Manager for validation
    - Invoke Orchestrator with resolved config
    - Handle exit codes: 0 if pass rate meets threshold, non-zero otherwise
    - Output report path on completion
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.3, 6.4, 9.5_

  - [x] 13.2 Add npm script and bin entry for CLI command
    - Add "bin" entry in package.json pointing to compiled CLI
    - Add npm scripts: "build", "start", "test"
    - _Requirements: 1.1_

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Integration testing and final wiring
  - [ ]* 15.1 Write integration tests for full lifecycle
    - Set up mock HTTP server simulating Target API
    - Test complete flow: generate → call → evaluate → report
    - Verify report file written with correct filename pattern
    - Verify exit code reflects pass rate vs threshold
    - _Requirements: 1.4, 5.7, 9.5_

  - [ ]* 15.2 Write integration tests for execution modes and error resilience
    - Test sequential mode processes turns one at a time
    - Test concurrent mode processes turns in parallel up to limit
    - Test error in one turn does not halt suite
    - Test error section in report groups by phase
    - _Requirements: 3.6, 3.7, 8.1, 8.2, 8.3, 8.4_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The LLM integration for Input_Generator and Judge_Evaluator should use a configurable LLM provider (e.g., OpenAI API) with the steering file content as system prompt
- fast-check is used for property-based testing as specified in the design

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2", "3.3", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["6.1", "7.1", "8.1", "9.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "7.2", "8.2", "9.2", "9.3"] },
    { "id": 6, "tasks": ["11.1"] },
    { "id": 7, "tasks": ["11.2", "11.3", "11.4", "11.5", "11.6"] },
    { "id": 8, "tasks": ["12.1"] },
    { "id": 9, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 10, "tasks": ["13.1"] },
    { "id": 11, "tasks": ["13.2"] },
    { "id": 12, "tasks": ["15.1", "15.2"] }
  ]
}
```
