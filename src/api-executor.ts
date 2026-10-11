/**
 * API Executor module for the Dynamic Multi-Agent Chatbot REST API Tester.
 *
 * Handles HTTP communication with the target API endpoint.
 * Supports sequential and concurrent execution modes with configurable timeouts
 * and concurrency limits.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */

import { fetch } from 'undici';
import type { GeneratedInput, APIResponse } from './types';

/**
 * Classify a network/fetch error into a structured error type.
 */
function classifyError(error: unknown): APIResponse['error'] {
  if (error instanceof Error) {
    const message = error.message || '';
    const name = error.name || '';
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const causeCode = cause?.code || '';
    const causeMessage = cause?.message || '';
    // Also check for code directly on the error (some Node.js errors)
    const errorCode = (error as { code?: string }).code || '';

    // AbortError from AbortController timeout
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { type: 'timeout', message: causeMessage || message || 'Request timed out' };
    }

    // ETIMEDOUT in the error message, cause code, or error code
    if (
      causeCode === 'ETIMEDOUT' ||
      errorCode === 'ETIMEDOUT' ||
      causeCode === 'UND_ERR_CONNECT_TIMEOUT' ||
      errorCode === 'UND_ERR_CONNECT_TIMEOUT' ||
      causeMessage.includes('ETIMEDOUT') ||
      message.includes('ETIMEDOUT')
    ) {
      return { type: 'timeout', message: causeMessage || message || 'Request timed out' };
    }

    // Connection refused
    if (
      causeCode === 'ECONNREFUSED' ||
      errorCode === 'ECONNREFUSED' ||
      causeMessage.includes('ECONNREFUSED') ||
      message.includes('ECONNREFUSED')
    ) {
      return { type: 'connection_refused', message: causeMessage || message || 'Connection refused' };
    }

    // DNS failure
    if (
      causeCode === 'ENOTFOUND' ||
      errorCode === 'ENOTFOUND' ||
      causeCode === 'EAI_AGAIN' ||
      errorCode === 'EAI_AGAIN' ||
      causeMessage.includes('ENOTFOUND') ||
      message.includes('ENOTFOUND') ||
      causeMessage.includes('EAI_AGAIN') ||
      message.includes('EAI_AGAIN') ||
      causeMessage.includes('getaddrinfo') ||
      message.includes('getaddrinfo')
    ) {
      return { type: 'dns_failure', message: causeMessage || message || 'DNS resolution failed' };
    }

    // TLS errors
    if (
      causeCode === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
      causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      causeCode === 'CERT_HAS_EXPIRED' ||
      causeCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      causeCode === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      errorCode === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
      errorCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      errorCode === 'CERT_HAS_EXPIRED' ||
      errorCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      errorCode === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      causeMessage.includes('TLS') ||
      causeMessage.includes('SSL') ||
      causeMessage.includes('certificate') ||
      message.includes('TLS') ||
      message.includes('SSL') ||
      message.includes('certificate')
    ) {
      return { type: 'tls_failure', message: causeMessage || message || 'TLS handshake failed' };
    }

    return { type: 'unknown', message: causeMessage || message || 'Unknown error occurred' };
  }

  return { type: 'unknown', message: String(error) };
}

/**
 * Execute a single HTTP POST request to the target API endpoint.
 *
 * @param input - The generated test input containing the payload
 * @param endpoint - The target API base URL (e.g., "http://localhost:3000")
 * @param timeoutMs - Request timeout in milliseconds (default: 30000)
 * @param authToken - Optional Bearer token for Authorization header
 * @param path - API endpoint path (default: "/chat")
 * @returns APIResponse with status code, headers, body, latency, and optional error
 */
export async function executeRequest(
  input: GeneratedInput,
  endpoint: string,
  timeoutMs: number = 30000,
  authToken?: string,
  path: string = '/chat'
): Promise<APIResponse> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = endpoint.endsWith('/')
    ? `${endpoint.slice(0, -1)}${normalizedPath}`
    : `${endpoint}${normalizedPath}`;
  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': input.contentType || 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startTime;

    // Convert headers to a plain object
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Parse body - attempt JSON first, fall back to text
    let body: unknown;
    const contentType = response.headers.get('content-type') || '';
    const rawBody = await response.text();

    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    } else {
      body = rawBody;
    }

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body,
      latencyMs,
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - startTime;
    const classifiedError = classifyError(error);

    return {
      statusCode: 0,
      headers: {},
      body: '',
      latencyMs,
      error: classifiedError,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Execute requests sequentially (one at a time, waiting for each to complete).
 *
 * @param inputs - Array of generated test inputs
 * @param endpoint - The target API base URL
 * @param timeoutMs - Request timeout in milliseconds (default: 30000)
 * @returns Array of APIResponse objects in the same order as inputs
 */
export async function executeSequential(
  inputs: GeneratedInput[],
  endpoint: string,
  timeoutMs: number = 30000
): Promise<APIResponse[]> {
  const results: APIResponse[] = [];

  for (const input of inputs) {
    const response = await executeRequest(input, endpoint, timeoutMs);
    results.push(response);
  }

  return results;
}

/**
 * Execute requests concurrently with a configurable concurrency limit.
 *
 * @param inputs - Array of generated test inputs
 * @param endpoint - The target API base URL
 * @param timeoutMs - Request timeout in milliseconds (default: 30000)
 * @param concurrencyLimit - Maximum number of concurrent requests (default: 5, max: 50)
 * @returns Array of APIResponse objects in the same order as inputs
 */
export async function executeConcurrent(
  inputs: GeneratedInput[],
  endpoint: string,
  timeoutMs: number = 30000,
  concurrencyLimit: number = 5
): Promise<APIResponse[]> {
  // Clamp concurrency limit to valid range [1, 50]
  const limit = Math.max(1, Math.min(50, concurrencyLimit));

  const results: APIResponse[] = new Array(inputs.length);
  let currentIndex = 0;

  async function processNext(): Promise<void> {
    while (currentIndex < inputs.length) {
      const index = currentIndex++;
      results[index] = await executeRequest(inputs[index], endpoint, timeoutMs);
    }
  }

  // Create worker promises up to the concurrency limit
  const workers: Promise<void>[] = [];
  const workerCount = Math.min(limit, inputs.length);

  for (let i = 0; i < workerCount; i++) {
    workers.push(processNext());
  }

  await Promise.all(workers);

  return results;
}
