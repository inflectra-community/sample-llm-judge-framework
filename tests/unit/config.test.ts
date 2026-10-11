import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig, ConfigurationError, PartialCLIOptions } from '../../src/config';

describe('resolveConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all relevant env vars
    delete process.env.API_TEST_ENDPOINT;
    delete process.env.API_TEST_TURNS;
    delete process.env.API_TEST_TIMEOUT;
    delete process.env.API_TEST_MODE;
    delete process.env.API_TEST_CONCURRENCY;
    delete process.env.API_TEST_CONTRACT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('endpoint validation', () => {
    it('accepts a valid HTTPS URL', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com/chat' });
      expect(config.endpoint).toBe('https://api.example.com/chat');
    });

    it('accepts a valid HTTP URL', () => {
      const config = resolveConfig({ endpoint: 'http://localhost:3000' });
      expect(config.endpoint).toBe('http://localhost:3000');
    });

    it('throws ConfigurationError when endpoint is missing', () => {
      expect(() => resolveConfig({})).toThrow(ConfigurationError);
      expect(() => resolveConfig({})).toThrow(/endpoint/);
    });

    it('throws ConfigurationError for non-HTTP(S) URL', () => {
      expect(() => resolveConfig({ endpoint: 'ftp://example.com' })).toThrow(ConfigurationError);
      expect(() => resolveConfig({ endpoint: 'ftp://example.com' })).toThrow(/endpoint/);
    });

    it('throws ConfigurationError for invalid URL format', () => {
      expect(() => resolveConfig({ endpoint: 'not-a-url' })).toThrow(ConfigurationError);
      expect(() => resolveConfig({ endpoint: 'not-a-url' })).toThrow(/endpoint/);
    });
  });

  describe('default values', () => {
    it('uses default turns=5 when not provided', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com' });
      expect(config.turnCount).toBe(5);
    });

    it('uses default timeout=30 (30000ms) when not provided', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com' });
      expect(config.timeoutMs).toBe(30000);
    });

    it('uses default mode=sequential when not provided', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com' });
      expect(config.executionMode).toBe('sequential');
    });

    it('uses default concurrency=5 when not provided', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com' });
      expect(config.concurrencyLimit).toBe(5);
    });

    it('uses default contractPath=./api-contract.json when not provided', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com' });
      expect(config.contractPath).toBe('./api-contract.json');
    });
  });

  describe('turns validation', () => {
    it('accepts turns=1 (minimum)', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', turns: 1 });
      expect(config.turnCount).toBe(1);
    });

    it('accepts turns=1000 (maximum)', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', turns: 1000 });
      expect(config.turnCount).toBe(1000);
    });

    it('throws for turns=0 (below minimum)', () => {
      expect(() => resolveConfig({ endpoint: 'https://api.example.com', turns: 0 }))
        .toThrow(/turns/);
    });

    it('throws for turns=1001 (above maximum)', () => {
      expect(() => resolveConfig({ endpoint: 'https://api.example.com', turns: 1001 }))
        .toThrow(/turns/);
    });

    it('throws for non-integer turns', () => {
      expect(() => resolveConfig({ endpoint: 'https://api.example.com', turns: 5.5 }))
        .toThrow(/turns/);
    });

    it('parses turns from string', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', turns: '10' });
      expect(config.turnCount).toBe(10);
    });
  });

  describe('timeout validation', () => {
    it('accepts timeout=1 (minimum)', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', timeout: 1 });
      expect(config.timeoutMs).toBe(1000);
    });

    it('accepts timeout=300 (maximum)', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', timeout: 300 });
      expect(config.timeoutMs).toBe(300000);
    });

    it('throws for timeout=0 (below minimum)', () => {
      expect(() => resolveConfig({ endpoint: 'https://api.example.com', timeout: 0 }))
        .toThrow(/timeout/);
    });

    it('throws for timeout=301 (above maximum)', () => {
      expect(() => resolveConfig({ endpoint: 'https://api.example.com', timeout: 301 }))
        .toThrow(/timeout/);
    });

    it('converts timeout seconds to milliseconds', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', timeout: 60 });
      expect(config.timeoutMs).toBe(60000);
    });
  });

  describe('mode validation', () => {
    it('accepts "sequential"', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', mode: 'sequential' });
      expect(config.executionMode).toBe('sequential');
    });

    it('accepts "concurrent"', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', mode: 'concurrent' });
      expect(config.executionMode).toBe('concurrent');
    });

    it('is case-insensitive', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', mode: 'CONCURRENT' });
      expect(config.executionMode).toBe('concurrent');
    });

    it('throws for invalid mode', () => {
      expect(() => resolveConfig({ endpoint: 'https://api.example.com', mode: 'parallel' }))
        .toThrow(/mode/);
    });
  });

  describe('concurrency validation', () => {
    it('accepts concurrency=1 (minimum)', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', concurrency: 1 });
      expect(config.concurrencyLimit).toBe(1);
    });

    it('accepts concurrency=100 (maximum)', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com', concurrency: 100 });
      expect(config.concurrencyLimit).toBe(100);
    });

    it('throws for concurrency=0 (below minimum)', () => {
      expect(() => resolveConfig({ endpoint: 'https://api.example.com', concurrency: 0 }))
        .toThrow(/concurrency/);
    });

    it('throws for concurrency=101 (above maximum)', () => {
      expect(() => resolveConfig({ endpoint: 'https://api.example.com', concurrency: 101 }))
        .toThrow(/concurrency/);
    });
  });

  describe('environment variable fallback', () => {
    it('reads endpoint from env var when CLI arg not provided', () => {
      process.env.API_TEST_ENDPOINT = 'https://env.example.com';
      const config = resolveConfig({});
      expect(config.endpoint).toBe('https://env.example.com');
    });

    it('reads turns from env var when CLI arg not provided', () => {
      process.env.API_TEST_ENDPOINT = 'https://api.example.com';
      process.env.API_TEST_TURNS = '20';
      const config = resolveConfig({});
      expect(config.turnCount).toBe(20);
    });

    it('reads timeout from env var when CLI arg not provided', () => {
      process.env.API_TEST_ENDPOINT = 'https://api.example.com';
      process.env.API_TEST_TIMEOUT = '60';
      const config = resolveConfig({});
      expect(config.timeoutMs).toBe(60000);
    });

    it('reads mode from env var when CLI arg not provided', () => {
      process.env.API_TEST_ENDPOINT = 'https://api.example.com';
      process.env.API_TEST_MODE = 'concurrent';
      const config = resolveConfig({});
      expect(config.executionMode).toBe('concurrent');
    });

    it('reads concurrency from env var when CLI arg not provided', () => {
      process.env.API_TEST_ENDPOINT = 'https://api.example.com';
      process.env.API_TEST_CONCURRENCY = '10';
      const config = resolveConfig({});
      expect(config.concurrencyLimit).toBe(10);
    });

    it('reads contractPath from env var when CLI arg not provided', () => {
      process.env.API_TEST_ENDPOINT = 'https://api.example.com';
      process.env.API_TEST_CONTRACT = './custom-contract.json';
      const config = resolveConfig({});
      expect(config.contractPath).toBe('./custom-contract.json');
    });
  });

  describe('CLI args override environment variables', () => {
    it('CLI endpoint overrides env var', () => {
      process.env.API_TEST_ENDPOINT = 'https://env.example.com';
      const config = resolveConfig({ endpoint: 'https://cli.example.com' });
      expect(config.endpoint).toBe('https://cli.example.com');
    });

    it('CLI turns overrides env var', () => {
      process.env.API_TEST_TURNS = '50';
      const config = resolveConfig({ endpoint: 'https://api.example.com', turns: 10 });
      expect(config.turnCount).toBe(10);
    });

    it('CLI timeout overrides env var', () => {
      process.env.API_TEST_TIMEOUT = '120';
      const config = resolveConfig({ endpoint: 'https://api.example.com', timeout: 45 });
      expect(config.timeoutMs).toBe(45000);
    });

    it('CLI mode overrides env var', () => {
      process.env.API_TEST_MODE = 'concurrent';
      const config = resolveConfig({ endpoint: 'https://api.example.com', mode: 'sequential' });
      expect(config.executionMode).toBe('sequential');
    });

    it('CLI concurrency overrides env var', () => {
      process.env.API_TEST_CONCURRENCY = '50';
      const config = resolveConfig({ endpoint: 'https://api.example.com', concurrency: 3 });
      expect(config.concurrencyLimit).toBe(3);
    });
  });

  describe('resolved config structure', () => {
    it('includes steering paths', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com' });
      expect(config.steeringPaths).toEqual({
        inputAgent: '.kiro/steering/input-agent.md',
        judgeAgent: '.kiro/steering/judge-agent.md',
        testPlan: '.kiro/steering/test-plan.md',
      });
    });

    it('includes output directory', () => {
      const config = resolveConfig({ endpoint: 'https://api.example.com' });
      expect(config.outputDir).toBe('./output');
    });
  });

  describe('error messages are descriptive', () => {
    it('missing endpoint error names the parameter', () => {
      try {
        resolveConfig({});
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigurationError);
        expect((e as ConfigurationError).message).toContain('endpoint');
      }
    });

    it('invalid range error names the parameter and range', () => {
      try {
        resolveConfig({ endpoint: 'https://api.example.com', turns: 2000 });
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigurationError);
        const msg = (e as ConfigurationError).message;
        expect(msg).toContain('turns');
        expect(msg).toContain('1');
        expect(msg).toContain('1000');
      }
    });
  });
});
