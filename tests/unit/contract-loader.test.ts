import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadContract, ContractLoadError } from '../../src/contract-loader';

describe('Contract Loader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-loader-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeContract(filename: string, content: string): string {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  // --- Valid OpenAPI contract for reuse ---
  const validOpenAPIContract = {
    openapi: '3.0.3',
    paths: {
      '/chat': {
        post: {
          parameters: [
            { name: 'Authorization', in: 'header', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['message'],
                  properties: {
                    message: { type: 'string' },
                    userId: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['reply'],
                    properties: {
                      reply: { type: 'string' },
                      confidence: { type: 'number' },
                    },
                  },
                },
              },
            },
            '400': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['error'],
                    properties: {
                      error: { type: 'string' },
                      code: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  // --- Valid JSON Schema contract for reuse ---
  const validJsonSchemaContract = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    definitions: {
      request: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          sessionId: { type: 'string' },
        },
      },
      headers: {
        properties: {
          'Content-Type': { type: 'string' },
          'X-API-Key': { type: 'string' },
        },
      },
      response: {
        type: 'object',
        required: ['reply'],
        properties: {
          reply: { type: 'string' },
          timestamp: { type: 'string' },
        },
      },
      error: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          statusCode: { type: 'integer' },
        },
      },
    },
    successStatusCodes: [200, 201],
    errorStatusCodes: [400, 500],
  };

  describe('File not found', () => {
    it('should throw ContractLoadError when file does not exist', async () => {
      const nonExistentPath = path.join(tmpDir, 'nonexistent.json');
      await expect(loadContract(nonExistentPath)).rejects.toThrow(ContractLoadError);
      await expect(loadContract(nonExistentPath)).rejects.toThrow(/not found at path/);
      await expect(loadContract(nonExistentPath)).rejects.toThrow(nonExistentPath);
    });
  });

  describe('File size exceeds 10MB', () => {
    it('should throw ContractLoadError when file exceeds 10MB', async () => {
      const largePath = path.join(tmpDir, 'large.json');
      // Create a file just over 10MB
      const fd = fs.openSync(largePath, 'w');
      fs.ftruncateSync(fd, 10 * 1024 * 1024 + 1);
      fs.closeSync(fd);

      await expect(loadContract(largePath)).rejects.toThrow(ContractLoadError);
      await expect(loadContract(largePath)).rejects.toThrow(/10 MB size limit/);
    });
  });

  describe('Invalid JSON', () => {
    it('should throw ContractLoadError with parse failure description', async () => {
      const filePath = writeContract('invalid.json', '{ not valid json }');
      await expect(loadContract(filePath)).rejects.toThrow(ContractLoadError);
      await expect(loadContract(filePath)).rejects.toThrow(/invalid JSON/);
    });

    it('should throw for non-object JSON (array)', async () => {
      const filePath = writeContract('array.json', '[1, 2, 3]');
      await expect(loadContract(filePath)).rejects.toThrow(ContractLoadError);
      await expect(loadContract(filePath)).rejects.toThrow(/invalid JSON/);
    });
  });

  describe('Format detection', () => {
    it('should reject when neither openapi nor $schema key is present', async () => {
      const filePath = writeContract('no-format.json', JSON.stringify({ foo: 'bar' }));
      await expect(loadContract(filePath)).rejects.toThrow(ContractLoadError);
      await expect(loadContract(filePath)).rejects.toThrow(/format could not be determined/);
    });

    it('should detect OpenAPI format when "openapi" key is present', async () => {
      const filePath = writeContract('openapi.json', JSON.stringify(validOpenAPIContract));
      const result = await loadContract(filePath);
      expect(result.format).toBe('openapi');
    });

    it('should detect JSON Schema format when "$schema" key is present', async () => {
      const filePath = writeContract('jsonschema.json', JSON.stringify(validJsonSchemaContract));
      const result = await loadContract(filePath);
      expect(result.format).toBe('jsonschema');
    });

    it('should prefer OpenAPI when both "openapi" and "$schema" keys are present', async () => {
      const combined = { ...validOpenAPIContract, $schema: 'http://json-schema.org/draft-07/schema#' };
      const filePath = writeContract('both.json', JSON.stringify(combined));
      const result = await loadContract(filePath);
      expect(result.format).toBe('openapi');
    });
  });

  describe('Required sections validation', () => {
    it('should reject contract missing request fields', async () => {
      const contract = {
        openapi: '3.0.3',
        paths: {
          '/chat': {
            post: {
              parameters: [
                { name: 'Authorization', in: 'header', required: true, schema: { type: 'string' } },
              ],
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { reply: { type: 'string' } },
                      },
                    },
                  },
                },
                '400': {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { error: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
      const filePath = writeContract('no-request.json', JSON.stringify(contract));
      await expect(loadContract(filePath)).rejects.toThrow(/request fields with types/);
    });

    it('should reject contract missing required headers', async () => {
      const contract = {
        openapi: '3.0.3',
        paths: {
          '/chat': {
            post: {
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { message: { type: 'string' } },
                    },
                  },
                },
              },
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { reply: { type: 'string' } },
                      },
                    },
                  },
                },
                '400': {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { error: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
      const filePath = writeContract('no-headers.json', JSON.stringify(contract));
      await expect(loadContract(filePath)).rejects.toThrow(/required headers/);
    });
  });

  describe('Successful loading', () => {
    it('should return a valid APIContract for OpenAPI format', async () => {
      const filePath = writeContract('valid-openapi.json', JSON.stringify(validOpenAPIContract));
      const result = await loadContract(filePath);

      expect(result.format).toBe('openapi');
      expect(result.raw).toEqual(validOpenAPIContract);
      expect(result.requestSchema.requiredFields.length).toBeGreaterThan(0);
      expect(result.requestSchema.requiredHeaders).toHaveProperty('Authorization');
      expect(result.responseSchema.successStatusCodes).toContain(200);
      expect(result.responseSchema.bodyStructure.length).toBeGreaterThan(0);
      expect(result.responseSchema.errorFormat.length).toBeGreaterThan(0);
    });

    it('should return a valid APIContract for JSON Schema format', async () => {
      const filePath = writeContract('valid-jsonschema.json', JSON.stringify(validJsonSchemaContract));
      const result = await loadContract(filePath);

      expect(result.format).toBe('jsonschema');
      expect(result.raw).toEqual(validJsonSchemaContract);
      expect(result.requestSchema.requiredFields.length).toBeGreaterThan(0);
      expect(Object.keys(result.requestSchema.requiredHeaders).length).toBeGreaterThan(0);
      expect(result.responseSchema.successStatusCodes).toContain(200);
      expect(result.responseSchema.bodyStructure.length).toBeGreaterThan(0);
      expect(result.responseSchema.errorFormat.length).toBeGreaterThan(0);
    });

    it('should extract field definitions with correct types', async () => {
      const filePath = writeContract('fields.json', JSON.stringify(validOpenAPIContract));
      const result = await loadContract(filePath);

      const messageField = result.requestSchema.requiredFields.find(f => f.name === 'message');
      expect(messageField).toBeDefined();
      expect(messageField!.type).toBe('string');
    });
  });
});
