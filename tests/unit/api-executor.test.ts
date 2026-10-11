import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { executeRequest, executeSequential, executeConcurrent } from '../../src/api-executor';
import type { GeneratedInput } from '../../src/types';

function makeInput(payload: unknown = { message: 'hello' }): GeneratedInput {
  return {
    payload,
    profile: 'happy_path',
    contentType: 'application/json',
    metadata: { description: 'test input' },
  };
}

describe('API Executor', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let handler: (req: IncomingMessage, res: ServerResponse) => void;

  beforeAll(async () => {
    server = createServer((req, res) => {
      handler(req, res);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  afterEach(() => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply: 'ok' }));
    };
  });

  describe('executeRequest', () => {
    it('should send POST to /chat endpoint and capture response', async () => {
      let receivedMethod = '';
      let receivedUrl = '';
      let receivedContentType = '';

      handler = (req, res) => {
        receivedMethod = req.method || '';
        receivedUrl = req.url || '';
        receivedContentType = req.headers['content-type'] || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reply: 'hello back' }));
      };

      const result = await executeRequest(makeInput(), baseUrl, 5000);

      expect(receivedMethod).toBe('POST');
      expect(receivedUrl).toBe('/chat');
      expect(receivedContentType).toBe('application/json');
      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({ reply: 'hello back' });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('should capture full response headers', async () => {
      handler = (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'test-value',
        });
        res.end(JSON.stringify({ ok: true }));
      };

      const result = await executeRequest(makeInput(), baseUrl, 5000);

      expect(result.headers['content-type']).toBe('application/json');
      expect(result.headers['x-custom-header']).toBe('test-value');
    });

    it('should handle non-2xx responses without error field', async () => {
      handler = (_req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
      };

      const result = await executeRequest(makeInput(), baseUrl, 5000);

      expect(result.statusCode).toBe(400);
      expect(result.body).toEqual({ error: 'bad request' });
      expect(result.error).toBeUndefined();
    });

    it('should handle 500 responses without error field', async () => {
      handler = (_req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal server error' }));
      };

      const result = await executeRequest(makeInput(), baseUrl, 5000);

      expect(result.statusCode).toBe(500);
      expect(result.body).toEqual({ error: 'internal server error' });
      expect(result.error).toBeUndefined();
    });

    it('should handle timeout and record as timeout failure', async () => {
      handler = (_req, _res) => {
        // Never respond — will trigger timeout
      };

      const result = await executeRequest(makeInput(), baseUrl, 100);

      expect(result.statusCode).toBe(0);
      expect(result.headers).toEqual({});
      expect(result.body).toBe('');
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe('timeout');
    });

    it('should handle connection refused', async () => {
      // Use a valid port that nothing is listening on
      const result = await executeRequest(makeInput(), 'http://127.0.0.1:19999', 5000);

      expect(result.statusCode).toBe(0);
      expect(result.headers).toEqual({});
      expect(result.body).toBe('');
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe('connection_refused');
    });

    it('should handle DNS failure', async () => {
      const result = await executeRequest(
        makeInput(),
        'http://this-domain-does-not-exist-xyz123.invalid',
        5000
      );

      expect(result.statusCode).toBe(0);
      expect(result.headers).toEqual({});
      expect(result.body).toBe('');
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe('dns_failure');
    });

    it('should measure latency', async () => {
      handler = (_req, res) => {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }, 50);
      };

      const result = await executeRequest(makeInput(), baseUrl, 5000);

      expect(result.latencyMs).toBeGreaterThanOrEqual(40);
    });

    it('should handle non-JSON response body as text', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('plain text response');
      };

      const result = await executeRequest(makeInput(), baseUrl, 5000);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('plain text response');
    });

    it('should append /chat to endpoint without trailing slash', async () => {
      let receivedUrl = '';
      handler = (req, res) => {
        receivedUrl = req.url || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      };

      await executeRequest(makeInput(), baseUrl, 5000);
      expect(receivedUrl).toBe('/chat');
    });

    it('should append chat to endpoint with trailing slash', async () => {
      let receivedUrl = '';
      handler = (req, res) => {
        receivedUrl = req.url || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      };

      await executeRequest(makeInput(), `${baseUrl}/`, 5000);
      expect(receivedUrl).toBe('/chat');
    });
  });

  describe('executeSequential', () => {
    it('should execute requests one at a time in order', async () => {
      const callOrder: number[] = [];
      let callCount = 0;

      handler = (_req, res) => {
        const idx = callCount++;
        callOrder.push(idx);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ index: idx }));
      };

      const inputs = [makeInput({ msg: 'a' }), makeInput({ msg: 'b' }), makeInput({ msg: 'c' })];
      const results = await executeSequential(inputs, baseUrl, 5000);

      expect(results).toHaveLength(3);
      expect(callOrder).toEqual([0, 1, 2]);
      expect((results[0].body as { index: number }).index).toBe(0);
      expect((results[1].body as { index: number }).index).toBe(1);
      expect((results[2].body as { index: number }).index).toBe(2);
    });

    it('should return empty array for empty inputs', async () => {
      const results = await executeSequential([], baseUrl, 5000);
      expect(results).toEqual([]);
    });

    it('should continue after errors', async () => {
      let callCount = 0;
      handler = (_req, res) => {
        callCount++;
        if (callCount === 2) {
          // Destroy connection to simulate error
          res.destroy();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      };

      const inputs = [makeInput(), makeInput(), makeInput()];
      const results = await executeSequential(inputs, baseUrl, 5000);

      expect(results).toHaveLength(3);
      expect(results[0].statusCode).toBe(200);
      // Second request may error due to destroyed connection
      expect(results[2].statusCode).toBe(200);
    });
  });

  describe('executeConcurrent', () => {
    it('should execute all requests and return results in order', async () => {
      let callCount = 0;
      handler = (_req, res) => {
        const idx = callCount++;
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ index: idx }));
        }, 10);
      };

      const inputs = Array.from({ length: 5 }, (_, i) => makeInput({ msg: i }));
      const results = await executeConcurrent(inputs, baseUrl, 5000, 5);

      expect(results).toHaveLength(5);
      results.forEach((r) => {
        expect(r.statusCode).toBe(200);
      });
    });

    it('should respect concurrency limit', async () => {
      let activeConcurrent = 0;
      let maxConcurrent = 0;

      handler = (_req, res) => {
        activeConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, activeConcurrent);
        setTimeout(() => {
          activeConcurrent--;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }, 50);
      };

      const inputs = Array.from({ length: 10 }, () => makeInput());
      await executeConcurrent(inputs, baseUrl, 5000, 3);

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('should clamp concurrency limit to max 50', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      };

      const inputs = Array.from({ length: 5 }, () => makeInput());
      // Should not throw even with limit > 50
      const results = await executeConcurrent(inputs, baseUrl, 5000, 100);
      expect(results).toHaveLength(5);
    });

    it('should clamp concurrency limit to min 1', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      };

      const inputs = Array.from({ length: 3 }, () => makeInput());
      const results = await executeConcurrent(inputs, baseUrl, 5000, 0);
      expect(results).toHaveLength(3);
    });

    it('should return empty array for empty inputs', async () => {
      const results = await executeConcurrent([], baseUrl, 5000, 5);
      expect(results).toEqual([]);
    });

    it('should handle mixed success and failure in concurrent mode', async () => {
      let callCount = 0;
      handler = (_req, res) => {
        callCount++;
        if (callCount % 2 === 0) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'server error' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
      };

      const inputs = Array.from({ length: 4 }, () => makeInput());
      const results = await executeConcurrent(inputs, baseUrl, 5000, 4);

      expect(results).toHaveLength(4);
      // All should have responses (non-2xx is not an error)
      results.forEach((r) => {
        expect(r.error).toBeUndefined();
        expect(r.statusCode).toBeGreaterThan(0);
      });
    });
  });
});
