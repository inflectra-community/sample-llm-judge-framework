/**
 * Unit tests for the Input Generator Agent.
 *
 * Tests the template-based payload generation for all four profiles,
 * error handling, and LLM provider integration.
 */

import { describe, it, expect } from 'vitest';
import { InputGeneratorAgent, LLMProvider } from '../../src/agents/input-generator';
import { APIContract, InputProfile } from '../../src/types';

/** Helper: create a minimal valid APIContract for testing. */
function createTestContract(): APIContract {
  return {
    format: 'openapi',
    raw: {},
    endpointPath: '/chat',
    requestSchema: {
      requiredFields: [
        { name: 'message', type: 'string', required: true },
        { name: 'userId', type: 'integer', required: true },
        { name: 'active', type: 'boolean', required: true },
      ],
      requiredHeaders: { 'Authorization': 'string', 'Content-Type': 'string' },
      contentType: 'application/json',
    },
    responseSchema: {
      successStatusCodes: [200],
      errorStatusCodes: [400, 500],
      bodyStructure: [
        { name: 'reply', type: 'string', required: true },
      ],
      errorFormat: [
        { name: 'error', type: 'string', required: true },
      ],
    },
  };
}

describe('InputGeneratorAgent', () => {
  const steeringContent = '# Steering: You are an adversarial input generator.';
  const contract = createTestContract();
  const testPlanContext = 'Focus on authentication edge cases.';

  describe('constructor', () => {
    it('should initialize with steering, contract, and test plan context', () => {
      const agent = new InputGeneratorAgent(steeringContent, contract, testPlanContext);
      expect(agent).toBeDefined();
    });

    it('should initialize without test plan context', () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      expect(agent).toBeDefined();
    });
  });

  describe('generatePayload - happy_path', () => {
    it('should produce a schema-conforming payload with all required fields', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('happy_path', 0);

      expect(result.profile).toBe('happy_path');
      expect(result.contentType).toBe('application/json');
      expect(result.metadata.description).toContain('Valid schema-conforming');

      const payload = result.payload as Record<string, unknown>;
      expect(payload).toHaveProperty('message');
      expect(payload).toHaveProperty('userId');
      expect(payload).toHaveProperty('active');
      expect(typeof payload.message).toBe('string');
      expect(typeof payload.userId).toBe('number');
      expect(typeof payload.active).toBe('boolean');
    });

    it('should produce varied payloads for different turn indices', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result0 = await agent.generatePayload('happy_path', 0);
      const result1 = await agent.generatePayload('happy_path', 1);

      const payload0 = result0.payload as Record<string, unknown>;
      const payload1 = result1.payload as Record<string, unknown>;
      // Different turn indices should produce different values
      expect(payload0.message).not.toBe(payload1.message);
    });
  });

  describe('generatePayload - boundary_values', () => {
    it('should produce payloads with extreme values', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('boundary_values', 0);

      expect(result.profile).toBe('boundary_values');
      expect(result.contentType).toBe('application/json');
      expect(result.metadata.description).toContain('Boundary value');
    });

    it('should include zero value variation', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('boundary_values', 0);
      const payload = result.payload as Record<string, unknown>;
      // Turn 0 maps to "zero value" variation
      expect(result.metadata.description).toContain('zero');
    });

    it('should include MAX_INT variation', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('boundary_values', 2);
      const payload = result.payload as Record<string, unknown>;
      expect(result.metadata.description).toContain('MAX_INT');
      // The integer field should have MAX_INT
      expect(payload.userId).toBe(2147483647);
    });

    it('should include MIN_INT variation', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('boundary_values', 3);
      const payload = result.payload as Record<string, unknown>;
      expect(result.metadata.description).toContain('MIN_INT');
      expect(payload.userId).toBe(-2147483648);
    });

    it('should include empty string variation', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('boundary_values', 4);
      const payload = result.payload as Record<string, unknown>;
      expect(result.metadata.description).toContain('empty string');
      expect(payload.message).toBe('');
    });

    it('should include 10000+ character string variation', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('boundary_values', 5);
      const payload = result.payload as Record<string, unknown>;
      expect(result.metadata.description).toContain('10000+');
      expect((payload.message as string).length).toBeGreaterThan(10000);
    });

    it('should include null value variation', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('boundary_values', 6);
      const payload = result.payload as Record<string, unknown>;
      expect(result.metadata.description).toContain('null');
      expect(payload.message).toBeNull();
    });
  });

  describe('generatePayload - malicious_content', () => {
    it('should produce SQL injection payload', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('malicious_content', 0);

      expect(result.profile).toBe('malicious_content');
      expect(result.contentType).toBe('application/json');
      expect(result.metadata.description).toContain('SQL injection');

      const payload = result.payload as Record<string, unknown>;
      expect(payload.message).toContain('DROP TABLE');
    });

    it('should produce XSS script payload', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('malicious_content', 1);

      const payload = result.payload as Record<string, unknown>;
      expect(payload.message).toContain('<script>');
      expect(result.metadata.description).toContain('XSS');
    });

    it('should produce null bytes payload', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('malicious_content', 2);

      const payload = result.payload as Record<string, unknown>;
      expect((payload.message as string)).toContain('\x00');
      expect(result.metadata.description).toContain('null bytes');
    });

    it('should produce control characters payload', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('malicious_content', 3);

      expect(result.metadata.description).toContain('control characters');
    });

    it('should produce emoji combinations payload', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('malicious_content', 4);

      const payload = result.payload as Record<string, unknown>;
      expect(result.metadata.description).toContain('emoji');
    });
  });

  describe('generatePayload - structural_anomalies', () => {
    it('should produce payload with missing all required keys', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('structural_anomalies', 0);

      expect(result.profile).toBe('structural_anomalies');
      expect(result.metadata.description).toContain('missing all required');

      const payload = result.payload as Record<string, unknown>;
      expect(Object.keys(payload)).toHaveLength(0);
    });

    it('should produce malformed JSON string payload', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('structural_anomalies', 2);

      expect(result.metadata.description).toContain('malformed JSON');
      expect(typeof result.payload).toBe('string');
    });

    it('should produce payload with incorrect content-type', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('structural_anomalies', 3);

      expect(result.contentType).toBe('text/plain');
      expect(result.metadata.description).toContain('incorrect content-type');
    });

    it('should produce array instead of object', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const result = await agent.generatePayload('structural_anomalies', 4);

      expect(Array.isArray(result.payload)).toBe(true);
      expect(result.metadata.description).toContain('array instead of object');
    });
  });

  describe('error handling', () => {
    it('should return error indication when LLM provider fails', async () => {
      const failingProvider: LLMProvider = {
        generate: async () => {
          throw new Error('LLM service unavailable');
        },
      };

      const agent = new InputGeneratorAgent(steeringContent, contract);
      agent.setLLMProvider(failingProvider);

      const result = await agent.generatePayload('happy_path', 0);

      expect(result.payload).toBeNull();
      expect(result.profile).toBe('happy_path');
      expect(result.metadata.description).toContain('[ERROR]');
      expect(result.metadata.description).toContain('LLM service unavailable');
    });

    it('should return error indication for non-Error throws', async () => {
      const failingProvider: LLMProvider = {
        generate: async () => {
          throw 'string error';
        },
      };

      const agent = new InputGeneratorAgent(steeringContent, contract);
      agent.setLLMProvider(failingProvider);

      const result = await agent.generatePayload('boundary_values', 0);

      expect(result.payload).toBeNull();
      expect(result.metadata.description).toContain('[ERROR]');
      expect(result.metadata.description).toContain('Unknown error');
    });
  });

  describe('LLM provider integration', () => {
    it('should use LLM provider when set and parse JSON response', async () => {
      const mockProvider: LLMProvider = {
        generate: async (systemPrompt: string, userPrompt: string) => {
          // Verify steering content is passed as part of system prompt
          expect(systemPrompt).toContain('adversarial input generator');
          // Verify API contract context is provided
          expect(systemPrompt).toContain('API Contract Context');
          expect(systemPrompt).toContain('message (string)');
          return JSON.stringify({ message: 'LLM generated', userId: 42, active: true });
        },
      };

      const agent = new InputGeneratorAgent(steeringContent, contract, testPlanContext);
      agent.setLLMProvider(mockProvider);

      const result = await agent.generatePayload('happy_path', 0);

      expect(result.profile).toBe('happy_path');
      expect(result.contentType).toBe('application/json');
      const payload = result.payload as Record<string, unknown>;
      expect(payload.message).toBe('LLM generated');
    });

    it('should handle non-JSON LLM output as text/plain', async () => {
      const mockProvider: LLMProvider = {
        generate: async () => 'This is not valid JSON',
      };

      const agent = new InputGeneratorAgent(steeringContent, contract);
      agent.setLLMProvider(mockProvider);

      const result = await agent.generatePayload('malicious_content', 0);

      expect(result.contentType).toBe('text/plain');
      expect(result.payload).toBe('This is not valid JSON');
    });

    it('should include test plan context in system prompt', async () => {
      const mockProvider: LLMProvider = {
        generate: async (systemPrompt: string) => {
          expect(systemPrompt).toContain('Focus on authentication edge cases');
          return '{"message": "test"}';
        },
      };

      const agent = new InputGeneratorAgent(steeringContent, contract, testPlanContext);
      agent.setLLMProvider(mockProvider);

      await agent.generatePayload('happy_path', 0);
    });
  });

  describe('GeneratedInput structure', () => {
    it('should always return valid GeneratedInput structure', async () => {
      const agent = new InputGeneratorAgent(steeringContent, contract);
      const profiles: InputProfile[] = ['happy_path', 'boundary_values', 'malicious_content', 'structural_anomalies'];

      for (const profile of profiles) {
        const result = await agent.generatePayload(profile, 0);
        expect(result).toHaveProperty('payload');
        expect(result).toHaveProperty('profile');
        expect(result).toHaveProperty('contentType');
        expect(result).toHaveProperty('metadata');
        expect(result.metadata).toHaveProperty('description');
        expect(result.profile).toBe(profile);
        expect(typeof result.contentType).toBe('string');
        expect(typeof result.metadata.description).toBe('string');
      }
    });
  });
});
