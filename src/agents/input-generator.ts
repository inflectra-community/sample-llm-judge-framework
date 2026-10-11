/**
 * Input Generator Agent
 *
 * LLM-backed agent that produces test payloads. Receives steering directives,
 * API contract context, and test plan focus areas. For now, uses a template-based
 * generator that doesn't require an actual LLM API key.
 *
 * Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 10.4, 10.7
 */

import { InputProfile, GeneratedInput, APIContract, FieldDefinition } from '../types';

/**
 * Interface for an LLM provider that can be swapped in later.
 */
export interface LLMProvider {
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
}

/**
 * Input Generator Agent that produces test payloads conforming to the assigned InputProfile.
 *
 * Initialized with steering file content, API contract context, and optional test plan context.
 * Uses a template-based generator by default (no external LLM dependency required).
 */
export class InputGeneratorAgent {
  private readonly steering: string;
  private readonly contract: APIContract;
  private readonly testPlanContext: string;
  private llmProvider?: LLMProvider;

  constructor(steering: string, contract: APIContract, testPlanContext?: string) {
    this.steering = steering;
    this.contract = contract;
    this.testPlanContext = testPlanContext ?? '';
  }

  /**
   * Set an optional LLM provider for dynamic payload generation.
   * When not set, the template-based generator is used.
   */
  setLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
  }

  /**
   * Generate a test payload conforming to the assigned InputProfile.
   *
   * @param profile - The input profile category to generate for
   * @param turnIndex - The current turn index (used for variation)
   * @param scenarioContext - Optional scenario description for this specific turn
   * @returns A GeneratedInput with payload, profile, contentType, and metadata
   */
  async generatePayload(profile: InputProfile, turnIndex: number, scenarioContext?: string): Promise<GeneratedInput> {
    try {
      if (this.llmProvider) {
        return await this.generateWithLLM(profile, turnIndex, scenarioContext);
      }
      return this.generateFromTemplate(profile, turnIndex);
    } catch (error: unknown) {
      // Handle LLM failures gracefully — return error indication
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        payload: null,
        profile,
        contentType: 'application/json',
        metadata: {
          description: `[ERROR] Input generation failed: ${message}`,
        },
      };
    }
  }

  /**
   * Generate payload using the LLM provider.
   */
  private async generateWithLLM(profile: InputProfile, turnIndex: number, scenarioContext?: string): Promise<GeneratedInput> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(profile, turnIndex, scenarioContext);

    const rawOutput = await this.llmProvider!.generate(systemPrompt, userPrompt);

    // Attempt to parse the LLM output as JSON
    let payload: unknown;
    let contentType = 'application/json';

    try {
      // Strip markdown code fences if present (```json ... ```)
      let cleaned = rawOutput.trim();
      const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
      if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
      }

      payload = JSON.parse(cleaned);

      // Handle double-encoding: if the result is a string that looks like JSON, parse again
      if (typeof payload === 'string') {
        try {
          const inner = JSON.parse(payload);
          if (typeof inner === 'object' && inner !== null) {
            payload = inner;
          }
        } catch {
          // It's genuinely a string payload (e.g., malformed JSON for structural anomalies)
        }
      }
    } catch {
      // If not valid JSON, treat as raw text payload
      payload = rawOutput;
      contentType = 'text/plain';
    }

    return {
      payload,
      profile,
      contentType,
      metadata: {
        description: `LLM-generated ${profile} payload for turn ${turnIndex}`,
      },
    };
  }

  /**
   * Build the system prompt from steering file and contract context.
   */
  private buildSystemPrompt(): string {
    return [
      this.steering,
      '',
      '## API Contract Context',
      `Format: ${this.contract.format}`,
      `Content-Type: ${this.contract.requestSchema.contentType}`,
      `Required Fields: ${this.contract.requestSchema.requiredFields.map(f => `${f.name} (${f.type})`).join(', ')}`,
      `Required Headers: ${Object.entries(this.contract.requestSchema.requiredHeaders).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
      '',
      this.testPlanContext ? `## Test Plan Context\n${this.testPlanContext}` : '',
    ].join('\n');
  }

  /**
   * Build the user prompt for a specific profile and turn.
   */
  private buildUserPrompt(profile: InputProfile, turnIndex: number, scenarioContext?: string): string {
    const profileDescriptions: Record<InputProfile, string> = {
      happy_path: 'Generate a valid, schema-conforming payload with realistic data.',
      boundary_values: 'Generate a payload with extreme boundary values (0, -1, MAX_INT, MIN_INT, empty strings, very long strings, null).',
      malicious_content: 'Generate a payload with malicious content (SQL injection, XSS, null bytes, control characters, emoji combinations).',
      structural_anomalies: 'Generate a payload with structural problems (missing required keys, malformed JSON, incorrect content-type).',
    };

    let prompt = `Turn ${turnIndex}. Profile: ${profile}. ${profileDescriptions[profile]}`;
    if (scenarioContext) {
      prompt += ` Scenario: ${scenarioContext}.`;
    }
    prompt += ' Output raw JSON payload only, no explanation or markdown.';
    return prompt;
  }

  /**
   * Template-based payload generator (no LLM required).
   * Produces deterministic but varied payloads based on profile and turn index.
   */
  private generateFromTemplate(profile: InputProfile, turnIndex: number): GeneratedInput {
    switch (profile) {
      case 'happy_path':
        return this.generateHappyPath(turnIndex);
      case 'boundary_values':
        return this.generateBoundaryValues(turnIndex);
      case 'malicious_content':
        return this.generateMaliciousContent(turnIndex);
      case 'structural_anomalies':
        return this.generateStructuralAnomalies(turnIndex);
    }
  }

  /**
   * Generate a valid, schema-conforming payload based on the API contract.
   */
  private generateHappyPath(turnIndex: number): GeneratedInput {
    const payload: Record<string, unknown> = {};

    for (const field of this.contract.requestSchema.requiredFields) {
      payload[field.name] = this.generateValidValue(field, turnIndex);
    }

    return {
      payload,
      profile: 'happy_path',
      contentType: this.contract.requestSchema.contentType,
      metadata: {
        description: `Valid schema-conforming payload (variation ${turnIndex})`,
      },
    };
  }

  /**
   * Generate a payload with extreme boundary values.
   */
  private generateBoundaryValues(turnIndex: number): GeneratedInput {
    const payload: Record<string, unknown> = {};
    const variations = this.getBoundaryVariations();
    const variationIndex = turnIndex % variations.length;
    const variation = variations[variationIndex];

    for (const field of this.contract.requestSchema.requiredFields) {
      payload[field.name] = this.applyBoundaryVariation(field, variation);
    }

    return {
      payload,
      profile: 'boundary_values',
      contentType: this.contract.requestSchema.contentType,
      metadata: {
        description: `Boundary value payload: ${variation.description}`,
      },
    };
  }

  /**
   * Generate a payload with malicious content.
   */
  private generateMaliciousContent(turnIndex: number): GeneratedInput {
    const payload: Record<string, unknown> = {};
    const attacks = this.getMaliciousVariations();
    const attackIndex = turnIndex % attacks.length;
    const attack = attacks[attackIndex];

    for (const field of this.contract.requestSchema.requiredFields) {
      payload[field.name] = attack.value;
    }

    return {
      payload,
      profile: 'malicious_content',
      contentType: this.contract.requestSchema.contentType,
      metadata: {
        description: `Malicious content payload: ${attack.description}`,
      },
    };
  }

  /**
   * Generate a payload with structural anomalies.
   */
  private generateStructuralAnomalies(turnIndex: number): GeneratedInput {
    const anomalies = this.getStructuralAnomalyVariations();
    const anomalyIndex = turnIndex % anomalies.length;
    const anomaly = anomalies[anomalyIndex];

    return {
      payload: anomaly.payload(this.contract.requestSchema.requiredFields),
      profile: 'structural_anomalies',
      contentType: anomaly.contentType,
      metadata: {
        description: `Structural anomaly payload: ${anomaly.description}`,
      },
    };
  }

  /**
   * Generate a valid value for a field based on its type.
   */
  private generateValidValue(field: FieldDefinition, turnIndex: number): unknown {
    switch (field.type) {
      case 'string':
        return this.getValidStringValue(field, turnIndex);
      case 'number':
      case 'integer':
        return this.getValidNumberValue(field, turnIndex);
      case 'boolean':
        return turnIndex % 2 === 0;
      case 'array':
        return [`item_${turnIndex}`];
      case 'object':
        return { key: `value_${turnIndex}` };
      default:
        return `value_${turnIndex}`;
    }
  }

  /**
   * Generate a valid string value, respecting constraints if present.
   */
  private getValidStringValue(field: FieldDefinition, turnIndex: number): string {
    const sampleStrings = [
      'Hello, how can I help you today?',
      'What is the weather like?',
      'Tell me a joke please.',
      'Can you summarize this article?',
      'What are your capabilities?',
      'How do I reset my password?',
      'I need help with my order.',
      'Explain quantum computing simply.',
    ];
    return sampleStrings[turnIndex % sampleStrings.length];
  }

  /**
   * Generate a valid number value, respecting constraints if present.
   */
  private getValidNumberValue(field: FieldDefinition, turnIndex: number): number {
    const min = (field.constraints?.minimum as number) ?? 1;
    const max = (field.constraints?.maximum as number) ?? 100;
    return min + (turnIndex % (max - min + 1));
  }

  /**
   * Get boundary value variations for testing extreme inputs.
   */
  private getBoundaryVariations(): Array<{ description: string; value: unknown; forType: string }> {
    return [
      { description: 'zero value', value: 0, forType: 'number' },
      { description: 'negative one', value: -1, forType: 'number' },
      { description: 'MAX_INT (2147483647)', value: 2147483647, forType: 'number' },
      { description: 'MIN_INT (-2147483648)', value: -2147483648, forType: 'number' },
      { description: 'empty string', value: '', forType: 'string' },
      { description: '10000+ character string', value: 'A'.repeat(10001), forType: 'string' },
      { description: 'null value', value: null, forType: 'any' },
      { description: 'Number.MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER, forType: 'number' },
      { description: 'Number.MIN_SAFE_INTEGER', value: Number.MIN_SAFE_INTEGER, forType: 'number' },
      { description: 'floating point precision', value: 0.1 + 0.2, forType: 'number' },
      { description: 'whitespace-only string', value: '   \t\n  ', forType: 'string' },
      { description: 'single character', value: 'a', forType: 'string' },
    ];
  }

  /**
   * Apply a boundary variation to a field based on its type.
   */
  private applyBoundaryVariation(
    field: FieldDefinition,
    variation: { description: string; value: unknown; forType: string }
  ): unknown {
    // If the variation type matches the field type, use it directly
    if (variation.forType === field.type || variation.forType === 'any') {
      return variation.value;
    }

    // Otherwise, convert the boundary concept to the field's type
    switch (field.type) {
      case 'string':
        if (variation.value === null) return null;
        return String(variation.value);
      case 'number':
      case 'integer':
        if (variation.value === null) return null;
        if (variation.value === '') return 0;
        return typeof variation.value === 'number' ? variation.value : 0;
      case 'boolean':
        return null;
      case 'array':
        return variation.value === null ? null : [];
      default:
        return variation.value;
    }
  }

  /**
   * Get malicious content variations for security testing.
   */
  private getMaliciousVariations(): Array<{ description: string; value: string }> {
    return [
      {
        description: 'SQL injection (DROP TABLE)',
        value: "'; DROP TABLE users; --",
      },
      {
        description: 'XSS script injection',
        value: "<script>alert('xss')</script>",
      },
      {
        description: 'null bytes',
        value: 'hello\x00world\x00test',
      },
      {
        description: 'control characters',
        value: '\x01\x02\x03\x04\x05\x06\x07\x08',
      },
      {
        description: 'emoji combinations',
        value: '👨‍👩‍👧‍👦🏳️‍🌈🇺🇸🧑‍💻🔥💯🎉👻',
      },
      {
        description: 'SQL injection (UNION SELECT)',
        value: "' UNION SELECT * FROM users WHERE '1'='1",
      },
      {
        description: 'XSS via img tag',
        value: '<img src=x onerror=alert("xss")>',
      },
      {
        description: 'path traversal',
        value: '../../../etc/passwd',
      },
      {
        description: 'command injection',
        value: '; rm -rf / ; echo "',
      },
      {
        description: 'mixed malicious with unicode',
        value: "'; DROP TABLE users; --\x00<script>alert('xss')</script>🔥",
      },
    ];
  }

  /**
   * Get structural anomaly variations for testing malformed inputs.
   */
  private getStructuralAnomalyVariations(): Array<{
    description: string;
    contentType: string;
    payload: (fields: FieldDefinition[]) => unknown;
  }> {
    return [
      {
        description: 'missing all required keys',
        contentType: 'application/json',
        payload: () => ({}),
      },
      {
        description: 'missing first required key',
        contentType: 'application/json',
        payload: (fields: FieldDefinition[]) => {
          const obj: Record<string, unknown> = {};
          // Include all fields except the first one
          for (let i = 1; i < fields.length; i++) {
            obj[fields[i].name] = `value_${i}`;
          }
          return obj;
        },
      },
      {
        description: 'malformed JSON string (not an object)',
        contentType: 'application/json',
        payload: () => '{invalid json content: [}',
      },
      {
        description: 'incorrect content-type (text/plain)',
        contentType: 'text/plain',
        payload: (fields: FieldDefinition[]) => {
          const obj: Record<string, unknown> = {};
          for (const field of fields) {
            obj[field.name] = `value`;
          }
          return obj;
        },
      },
      {
        description: 'array instead of object',
        contentType: 'application/json',
        payload: () => ['unexpected', 'array', 'payload'],
      },
      {
        description: 'nested null values for all fields',
        contentType: 'application/json',
        payload: (fields: FieldDefinition[]) => {
          const obj: Record<string, unknown> = {};
          for (const field of fields) {
            obj[field.name] = null;
          }
          return obj;
        },
      },
      {
        description: 'wrong types for all fields',
        contentType: 'application/json',
        payload: (fields: FieldDefinition[]) => {
          const obj: Record<string, unknown> = {};
          for (const field of fields) {
            // Assign wrong type: numbers get strings, strings get numbers, etc.
            switch (field.type) {
              case 'string':
                obj[field.name] = 12345;
                break;
              case 'number':
              case 'integer':
                obj[field.name] = 'not_a_number';
                break;
              case 'boolean':
                obj[field.name] = 'not_a_boolean';
                break;
              default:
                obj[field.name] = 99999;
            }
          }
          return obj;
        },
      },
      {
        description: 'empty body',
        contentType: 'application/json',
        payload: () => null,
      },
    ];
  }
}
