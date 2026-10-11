import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSteeringFile, SteeringFileError } from '../../src/steering-loader';

const TEST_DIR = join(__dirname, '__fixtures__', 'steering');

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(join(__dirname, '__fixtures__'), { recursive: true, force: true });
});

describe('loadSteeringFile', () => {
  it('should return file content on success', async () => {
    const filePath = join(TEST_DIR, 'valid.md');
    const content = '# Agent Persona\n\nYou are a helpful assistant.';
    await writeFile(filePath, content, 'utf-8');

    const result = await loadSteeringFile(filePath);
    expect(result).toBe(content);
  });

  it('should throw SteeringFileError when file is not found', async () => {
    const filePath = join(TEST_DIR, 'nonexistent.md');

    await expect(loadSteeringFile(filePath)).rejects.toThrow(SteeringFileError);
    await expect(loadSteeringFile(filePath)).rejects.toThrow(filePath);
  });

  it('should include file path in error message for missing files', async () => {
    const filePath = join(TEST_DIR, 'does-not-exist.md');

    try {
      await loadSteeringFile(filePath);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SteeringFileError);
      expect((err as SteeringFileError).message).toContain(filePath);
      expect((err as SteeringFileError).filePath).toBe(filePath);
    }
  });

  it('should throw SteeringFileError when file is empty', async () => {
    const filePath = join(TEST_DIR, 'empty.md');
    await writeFile(filePath, '', 'utf-8');

    await expect(loadSteeringFile(filePath)).rejects.toThrow(SteeringFileError);
    await expect(loadSteeringFile(filePath)).rejects.toThrow(filePath);
  });

  it('should throw SteeringFileError when file contains only whitespace', async () => {
    const filePath = join(TEST_DIR, 'whitespace.md');
    await writeFile(filePath, '   \n\t\n   \r\n  ', 'utf-8');

    await expect(loadSteeringFile(filePath)).rejects.toThrow(SteeringFileError);
    await expect(loadSteeringFile(filePath)).rejects.toThrow('empty or contains only whitespace');
  });

  it('should preserve full file content including whitespace', async () => {
    const filePath = join(TEST_DIR, 'with-whitespace.md');
    const content = '  # Title  \n\n  Some content with leading spaces  \n';
    await writeFile(filePath, content, 'utf-8');

    const result = await loadSteeringFile(filePath);
    expect(result).toBe(content);
  });

  it('should handle files with only newlines as whitespace-only', async () => {
    const filePath = join(TEST_DIR, 'newlines-only.md');
    await writeFile(filePath, '\n\n\n', 'utf-8');

    await expect(loadSteeringFile(filePath)).rejects.toThrow(SteeringFileError);
  });
});
