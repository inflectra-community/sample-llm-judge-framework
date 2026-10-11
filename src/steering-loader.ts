import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

/**
 * Custom error class for steering file loading failures.
 * Always includes the file path in the error message.
 */
export class SteeringFileError extends Error {
  public readonly filePath: string;

  constructor(message: string, filePath: string) {
    super(message);
    this.name = 'SteeringFileError';
    this.filePath = filePath;
  }
}

/**
 * Loads a steering file from the given path.
 *
 * @param filePath - Absolute or relative path to the steering file
 * @returns The full text content of the file
 * @throws {SteeringFileError} If the file is not found, unreadable, or empty/whitespace-only
 */
export async function loadSteeringFile(filePath: string): Promise<string> {
  // Check if file exists and is readable
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new SteeringFileError(
      `Steering file not found or unreadable: ${filePath}`,
      filePath
    );
  }

  // Read file content
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    throw new SteeringFileError(
      `Failed to read steering file: ${filePath}`,
      filePath
    );
  }

  // Reject empty or whitespace-only content
  if (content.trim().length === 0) {
    throw new SteeringFileError(
      `Steering file is empty or contains only whitespace: ${filePath}`,
      filePath
    );
  }

  return content;
}
