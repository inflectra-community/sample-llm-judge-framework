/**
 * API Contract Loader
 *
 * Loads and validates the API contract file. Supports OpenAPI 3.x and JSON Schema Draft 7+ formats.
 * Extracts request/response schemas into a structured APIContract object.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.6
 */

import * as fs from 'fs';
import * as path from 'path';
import { APIContract, RequestSchema, ResponseSchema, FieldDefinition } from './types';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Custom error class for contract loading failures. */
export class ContractLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractLoadError';
  }
}

/**
 * Loads and validates an API contract file, returning a structured APIContract object.
 *
 * @param filePath - Path to the API contract JSON file
 * @returns Parsed and validated APIContract
 * @throws ContractLoadError on any failure (file not found, too large, invalid JSON, unknown format, missing sections)
 */
export async function loadContract(filePath: string): Promise<APIContract> {
  const resolvedPath = path.resolve(filePath);

  // 1. Check file exists and is readable
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(resolvedPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ContractLoadError(
        `API contract file not found at path: ${resolvedPath}. Schema validation cannot proceed without a contract file.`
      );
    }
    throw new ContractLoadError(
      `API contract file is unreadable at path: ${resolvedPath}. ${(err as Error).message}`
    );
  }

  // 2. Check file size <= 10MB
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    throw new ContractLoadError(
      `API contract file exceeds the 10 MB size limit (${(stats.size / (1024 * 1024)).toFixed(2)} MB). Please reduce the file size.`
    );
  }

  // 3. Read and parse JSON
  let rawContent: string;
  try {
    rawContent = await fs.promises.readFile(resolvedPath, 'utf-8');
  } catch (err: unknown) {
    throw new ContractLoadError(
      `API contract file is unreadable at path: ${resolvedPath}. ${(err as Error).message}`
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err: unknown) {
    throw new ContractLoadError(
      `API contract file contains invalid JSON: ${(err as Error).message}`
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ContractLoadError(
      `API contract file contains invalid JSON: expected a JSON object at the top level.`
    );
  }

  // 4. Detect format
  const format = detectFormat(parsed);

  // 5. Extract schemas based on format
  let requestSchema: RequestSchema;
  let responseSchema: ResponseSchema;
  let endpointPath = '/chat'; // default fallback

  if (format === 'openapi') {
    const extracted = extractOpenAPISchemas(parsed);
    requestSchema = extracted.requestSchema;
    responseSchema = extracted.responseSchema;
    endpointPath = extracted.endpointPath;
  } else {
    const extracted = extractJsonSchemaSchemas(parsed);
    requestSchema = extracted.requestSchema;
    responseSchema = extracted.responseSchema;
    // For JSON Schema format, check for an explicit endpointPath field
    if (typeof (parsed as Record<string, unknown>).endpointPath === 'string') {
      endpointPath = (parsed as Record<string, unknown>).endpointPath as string;
    }
  }

  // 6. Validate required sections
  validateRequiredSections(requestSchema, responseSchema);

  return {
    format,
    raw: parsed,
    endpointPath,
    requestSchema,
    responseSchema,
  };
}

/**
 * Detects the contract format based on top-level keys.
 */
function detectFormat(parsed: Record<string, unknown>): 'openapi' | 'jsonschema' {
  if ('openapi' in parsed) {
    return 'openapi';
  }
  if ('$schema' in parsed) {
    return 'jsonschema';
  }
  throw new ContractLoadError(
    `API contract format could not be determined. The file must contain either an "openapi" key (for OpenAPI 3.x) or a "$schema" key (for JSON Schema Draft 7+). Neither key was found.`
  );
}

/**
 * Extracts request and response schemas from an OpenAPI 3.x document.
 */
function extractOpenAPISchemas(doc: Record<string, unknown>): {
  requestSchema: RequestSchema;
  responseSchema: ResponseSchema;
  endpointPath: string;
} {
  const paths = doc.paths as Record<string, Record<string, unknown>> | undefined;
  const components = doc.components as Record<string, unknown> | undefined;

  // Find the first path/operation to extract schemas from
  let requestBody: Record<string, unknown> | undefined;
  let responses: Record<string, unknown> | undefined;
  let parameters: Array<Record<string, unknown>> | undefined;
  let endpointPath = '/chat'; // default

  if (paths) {
    for (const pathKey of Object.keys(paths)) {
      const pathItem = paths[pathKey];
      // Look for POST operation first, then any operation
      const operation = (pathItem.post || pathItem.put || pathItem.patch ||
        pathItem.get || pathItem.delete) as Record<string, unknown> | undefined;
      if (operation) {
        endpointPath = pathKey;
        requestBody = operation.requestBody as Record<string, unknown> | undefined;
        responses = operation.responses as Record<string, unknown> | undefined;
        parameters = operation.parameters as Array<Record<string, unknown>> | undefined;
        break;
      }
    }
  }

  // Extract request fields from requestBody schema
  const requiredFields: FieldDefinition[] = [];
  let contentType = 'application/json';

  if (requestBody) {
    const content = requestBody.content as Record<string, Record<string, unknown>> | undefined;
    if (content) {
      // Prefer application/json
      const mediaType = content['application/json'] || Object.values(content)[0];
      if (mediaType) {
        contentType = Object.keys(content).includes('application/json')
          ? 'application/json'
          : Object.keys(content)[0];
        const schema = resolveSchema(mediaType.schema as Record<string, unknown>, components);
        if (schema) {
          extractFieldDefinitions(schema, requiredFields);
        }
      }
    }
  }

  // Extract required headers from parameters
  const requiredHeaders: Record<string, string> = {};
  if (parameters) {
    for (const param of parameters) {
      if (param.in === 'header') {
        const name = param.name as string;
        const schema = param.schema as Record<string, unknown> | undefined;
        const type = schema?.type as string || 'string';
        requiredHeaders[name] = type;
      }
    }
  }

  // Also check for security schemes to add auth headers
  if (components) {
    const securitySchemes = (components as Record<string, unknown>).securitySchemas as Record<string, Record<string, unknown>> | undefined
      || (components as Record<string, unknown>).securitySchemes as Record<string, Record<string, unknown>> | undefined;
    if (securitySchemes) {
      for (const scheme of Object.values(securitySchemes)) {
        if (scheme.type === 'apiKey' && scheme.in === 'header') {
          requiredHeaders[scheme.name as string] = 'string';
        }
      }
    }
  }

  // Extract response schemas
  const successStatusCodes: number[] = [];
  const errorStatusCodes: number[] = [];
  const bodyStructure: FieldDefinition[] = [];
  const errorFormat: FieldDefinition[] = [];

  if (responses) {
    for (const [statusCode, responseObj] of Object.entries(responses)) {
      const code = parseInt(statusCode, 10);
      const responseData = responseObj as Record<string, unknown>;

      if (!isNaN(code)) {
        if (code >= 200 && code < 300) {
          successStatusCodes.push(code);
          // Extract body structure from success response
          if (bodyStructure.length === 0) {
            const content = responseData.content as Record<string, Record<string, unknown>> | undefined;
            if (content) {
              const mediaType = content['application/json'] || Object.values(content)[0];
              if (mediaType) {
                const schema = resolveSchema(mediaType.schema as Record<string, unknown>, components);
                if (schema) {
                  extractFieldDefinitions(schema, bodyStructure);
                }
              }
            }
          }
        } else if (code >= 400) {
          errorStatusCodes.push(code);
          // Extract error format from first error response
          if (errorFormat.length === 0) {
            const content = responseData.content as Record<string, Record<string, unknown>> | undefined;
            if (content) {
              const mediaType = content['application/json'] || Object.values(content)[0];
              if (mediaType) {
                const schema = resolveSchema(mediaType.schema as Record<string, unknown>, components);
                if (schema) {
                  extractFieldDefinitions(schema, errorFormat);
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    endpointPath,
    requestSchema: {
      requiredFields,
      requiredHeaders,
      contentType,
    },
    responseSchema: {
      successStatusCodes,
      errorStatusCodes,
      bodyStructure,
      errorFormat,
    },
  };
}

/**
 * Extracts request and response schemas from a JSON Schema document.
 */
function extractJsonSchemaSchemas(doc: Record<string, unknown>): {
  requestSchema: RequestSchema;
  responseSchema: ResponseSchema;
} {
  const definitions = (doc.definitions || doc.properties || doc) as Record<string, unknown>;

  // Look for request schema
  const requestDef = (definitions.request || definitions.requestBody || definitions.Request) as Record<string, unknown> | undefined;
  const requiredFields: FieldDefinition[] = [];
  let contentType = 'application/json';

  if (requestDef) {
    extractFieldDefinitions(requestDef, requiredFields);
    if (requestDef.contentType) {
      contentType = requestDef.contentType as string;
    }
  }

  // Look for headers
  const requiredHeaders: Record<string, string> = {};
  const headersDef = (definitions.headers || definitions.requestHeaders || definitions.Headers) as Record<string, unknown> | undefined;
  if (headersDef) {
    const props = (headersDef.properties || headersDef) as Record<string, unknown>;
    const required = (headersDef.required || []) as string[];
    for (const [name, schema] of Object.entries(props)) {
      if (name === 'type' || name === 'required' || name === 'properties') continue;
      const fieldSchema = schema as Record<string, unknown>;
      requiredHeaders[name] = (fieldSchema.type as string) || 'string';
    }
    // If no explicit required array, treat all as required
    if (required.length === 0 && Object.keys(requiredHeaders).length > 0) {
      // headers are already added
    }
  }

  // Look for response schema
  const responseDef = (definitions.response || definitions.responseBody || definitions.Response) as Record<string, unknown> | undefined;
  const bodyStructure: FieldDefinition[] = [];
  const successStatusCodes: number[] = [];
  const errorStatusCodes: number[] = [];

  if (responseDef) {
    extractFieldDefinitions(responseDef, bodyStructure);
    // Extract status codes if defined
    const statusCodes = responseDef.successStatusCodes as number[] | undefined;
    if (statusCodes) {
      successStatusCodes.push(...statusCodes);
    }
    const errCodes = responseDef.errorStatusCodes as number[] | undefined;
    if (errCodes) {
      errorStatusCodes.push(...errCodes);
    }
  }

  // Look for status codes at top level
  if (successStatusCodes.length === 0) {
    const codes = doc.successStatusCodes as number[] | undefined;
    if (codes) {
      successStatusCodes.push(...codes);
    }
  }
  if (errorStatusCodes.length === 0) {
    const codes = doc.errorStatusCodes as number[] | undefined;
    if (codes) {
      errorStatusCodes.push(...codes);
    }
  }

  // Look for error format
  const errorDef = (definitions.error || definitions.errorResponse || definitions.Error) as Record<string, unknown> | undefined;
  const errorFormat: FieldDefinition[] = [];
  if (errorDef) {
    extractFieldDefinitions(errorDef, errorFormat);
  }

  return {
    requestSchema: {
      requiredFields,
      requiredHeaders,
      contentType,
    },
    responseSchema: {
      successStatusCodes,
      errorStatusCodes,
      bodyStructure,
      errorFormat,
    },
  };
}

/**
 * Resolves a schema reference ($ref) if present, otherwise returns the schema as-is.
 */
function resolveSchema(
  schema: Record<string, unknown> | undefined,
  components: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!schema) return undefined;

  if (schema.$ref && typeof schema.$ref === 'string') {
    // Resolve $ref like "#/components/schemas/ChatRequest"
    const refPath = (schema.$ref as string).replace('#/', '').split('/');
    let resolved: unknown = { components };
    // Start from root which includes components
    resolved = components;
    for (let i = 1; i < refPath.length; i++) {
      if (resolved && typeof resolved === 'object') {
        resolved = (resolved as Record<string, unknown>)[refPath[i]];
      } else {
        return undefined;
      }
    }
    return resolved as Record<string, unknown> | undefined;
  }

  return schema;
}

/**
 * Extracts field definitions from a JSON Schema-like object.
 */
function extractFieldDefinitions(
  schema: Record<string, unknown>,
  fields: FieldDefinition[]
): void {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required || []) as string[];

  if (properties) {
    for (const [name, propSchema] of Object.entries(properties)) {
      const type = (propSchema.type as string) || 'unknown';
      const constraints: Record<string, unknown> = {};

      // Collect constraints
      for (const [key, value] of Object.entries(propSchema)) {
        if (key !== 'type' && key !== 'description') {
          constraints[key] = value;
        }
      }

      fields.push({
        name,
        type,
        required: required.includes(name),
        constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
      });
    }
  } else if (schema.type === 'object' && !properties) {
    // Schema is an object type but has no properties defined yet
    // This is valid but empty
  }
}

/**
 * Validates that all required sections are present in the extracted schemas.
 */
function validateRequiredSections(
  requestSchema: RequestSchema,
  responseSchema: ResponseSchema
): void {
  const missing: string[] = [];

  if (requestSchema.requiredFields.length === 0) {
    missing.push('request fields with types');
  }

  if (Object.keys(requestSchema.requiredHeaders).length === 0) {
    missing.push('required headers');
  }

  if (responseSchema.successStatusCodes.length === 0) {
    missing.push('success status codes');
  }

  if (responseSchema.bodyStructure.length === 0) {
    missing.push('response body structure');
  }

  if (responseSchema.errorFormat.length === 0) {
    missing.push('error format');
  }

  if (missing.length > 0) {
    throw new ContractLoadError(
      `API contract is missing required sections: ${missing.join(', ')}. The contract must define request fields with types, required headers, success status codes, response body structure, and error format.`
    );
  }
}
