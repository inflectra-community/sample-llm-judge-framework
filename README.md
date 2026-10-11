# Multi-Agent API Tester

A dynamic, multi-agent framework that stress-tests and evaluates a Chatbot REST API. It uses an Orchestrator pattern with specialized AI-driven sub-agents — one generates diverse adversarial test payloads, the other critically judges the API's responses — all steered by customizable markdown persona files.

## How It Works

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Input     │────▶│   Target API     │────▶│   Judge     │
│  Generator  │     │   POST /chat     │     │  Evaluator  │
└─────────────┘     └──────────────────┘     └─────────────┘
       ▲                                            │
       │            ┌──────────────────┐            │
       └────────────│   Orchestrator   │◀───────────┘
                    └──────────────────┘
                             │
                    ┌──────────────────┐
                    │  Summary Report  │
                    └──────────────────┘
```

Each test turn follows a pipeline:
1. **Generate** — The Input Generator creates a test payload (valid, boundary, malicious, or malformed)
2. **Execute** — The payload is sent to your chatbot API
3. **Evaluate** — The Judge Evaluator scores the response against your API contract
4. **Record** — Results are aggregated into a Markdown report

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure your environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
API_TEST_ENDPOINT=https://your-chatbot-api.com
API_TEST_AUTH_TOKEN=your-bearer-token-here
```

### 3. Set up your API contract

The framework needs an API contract file that describes your chatbot's request/response schema. A sample is included at `api-contract.json`. Edit it to match your API's actual schema.

### 4. Run the tests

```bash
npx ts-node src/cli.ts
```

That's it. The framework reads your `.env`, generates test inputs, calls your API, evaluates responses, and writes a summary report to `./output/`.

## Configuration

All settings can be provided via `.env` file, environment variables, or CLI flags. CLI flags take precedence over env vars.

| Setting | Env Variable | CLI Flag | Default | Description |
|---------|-------------|----------|---------|-------------|
| Endpoint | `API_TEST_ENDPOINT` | `--endpoint, -e` | (required) | Your chatbot API base URL |
| Auth Token | `API_TEST_AUTH_TOKEN` | `--auth-token` | (none) | Bearer token sent in Authorization header |
| Turn Count | `API_TEST_TURNS` | `--turns, -t` | 5 | Number of test turns to execute (1-1000) |
| Timeout | `API_TEST_TIMEOUT` | `--timeout` | 30 | Request timeout in seconds (1-300) |
| Mode | `API_TEST_MODE` | `--mode, -m` | sequential | Execution mode: `sequential` or `concurrent` |
| Concurrency | `API_TEST_CONCURRENCY` | `--concurrency, -c` | 5 | Max parallel requests in concurrent mode (1-100) |
| Contract Path | `API_TEST_CONTRACT` | `--contract-path` | ./api-contract.json | Path to your API contract file |

### Examples

```bash
# Run 20 turns against your API
npx ts-node src/cli.ts --turns 20

# Run in concurrent mode with 10 parallel requests
npx ts-node src/cli.ts --turns 50 --mode concurrent --concurrency 10

# Override endpoint from CLI (ignores .env)
npx ts-node src/cli.ts --endpoint https://staging-api.example.com --turns 10

# Use a custom contract file
npx ts-node src/cli.ts --contract-path ./contracts/v2-contract.json
```

## Input Profiles

The Input Generator rotates through four attack profiles:

| Profile | What It Tests |
|---------|--------------|
| **Happy Path** | Valid, schema-conforming requests with realistic data |
| **Boundary Values** | Extreme numbers (0, -1, MAX_INT), empty strings, 10000+ char strings, null values |
| **Malicious Content** | SQL injection, XSS scripts, null bytes, control characters, emoji combinations |
| **Structural Anomalies** | Missing required fields, malformed JSON, wrong content-types, arrays instead of objects |

## Steering Files

Agent behavior is controlled by markdown files in `.kiro/steering/`. Edit these to customize how inputs are generated and responses are judged — no code changes needed.

| File | Purpose |
|------|---------|
| `.kiro/steering/input-agent.md` | Persona and directives for the Input Generator |
| `.kiro/steering/judge-agent.md` | Evaluation criteria and output format for the Judge |
| `.kiro/steering/test-plan.md` | Profile distribution, scenarios, priorities, and pass threshold |

### Test Plan

The test plan controls how the test suite is structured:

```markdown
## Profile Distribution
happy_path: 40
boundary_values: 25
malicious_content: 20
structural_anomalies: 15

## Scenario Sequences
- happy_path: Send a greeting and verify response
- malicious_content: Attempt SQL injection

## Priority Areas
- Authentication handling
- Input sanitization

## Threshold
75
```

- **Profile Distribution** — Percentage allocation for each profile (must sum to 100)
- **Scenario Sequences** — Ordered steps executed first, counting toward total turns
- **Priority Areas** — Focus directives passed to the Input Generator
- **Threshold** — Minimum pass rate percentage. Exit code is 0 if met, 1 if not.

If the test plan file is missing, defaults are used (25% each profile, 100% threshold).

## API Contract

The contract file defines your API's expected request and response schemas. It supports two formats:

- **OpenAPI 3.x** — Must have an `"openapi"` top-level key
- **JSON Schema Draft 7+** — Must have a `"$schema"` top-level key

The contract must define:
- Required request fields with data types
- Required headers (e.g., Authorization)
- Expected success response status codes and body structure
- Expected error response format

See `api-contract.json` for a working example.

## Output

After a run completes, a Markdown report is written to `./output/summary_report_<timestamp>.md` containing:

- **Overall statistics** — Total tests, pass/fail counts, pass rate
- **Failure breakdown** — Counts by category (schema violation, unhandled exception, logic error, security risk, performance issue)
- **Profile breakdown** — Pass/fail rates per input profile
- **Failed test details** — Full input, response, and assertion details for each failure
- **Error section** — Any turns that were skipped or errored, grouped by phase

## Project Structure

```
src/
├── cli.ts                  # CLI entry point
├── config.ts               # Configuration resolution and validation
├── orchestrator.ts         # Central coordination engine
├── api-executor.ts         # HTTP request execution
├── profile-allocator.ts    # Turn-to-profile assignment
├── test-plan-parser.ts     # Test plan file parsing
├── contract-loader.ts      # API contract loading and validation
├── steering-loader.ts      # Steering file loading
├── report-generator.ts     # Markdown report generation
├── types.ts                # Shared TypeScript interfaces
└── agents/
    ├── input-generator.ts  # Test payload generation
    └── judge-evaluator.ts  # Response evaluation
```

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npx tsc --noEmit

# Build to dist/
npm run build
```

## Error Handling

The framework uses a **fail-forward** strategy:

- **Pre-flight errors** (bad config, missing files) cause immediate exit with a descriptive message
- **Per-turn errors** (LLM failure, timeout, connection issue) are isolated — the turn is marked as skipped/errored and the suite continues
- **All errors appear in the final report** grouped by phase

This ensures you always get maximum coverage from each run, even if some turns encounter issues.
