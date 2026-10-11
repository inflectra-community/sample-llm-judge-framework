/**
 * LLM Provider Factory
 *
 * Supports OpenAI and Amazon Bedrock as LLM backends.
 * Configured via environment variables.
 */

import OpenAI from 'openai';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { LLMProvider } from './agents/input-generator';

/**
 * Creates an OpenAI-backed LLM provider.
 *
 * @param apiKey - OpenAI API key
 * @param orgId - Optional OpenAI Organization ID
 * @param model - Model to use (default: gpt-4o-mini)
 * @returns LLMProvider instance
 */
export function createOpenAIProvider(
  apiKey: string,
  orgId?: string,
  model: string = 'gpt-4o-mini'
): LLMProvider {
  const client = new OpenAI({
    apiKey,
    organization: orgId || undefined,
  });

  return {
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 2048,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI returned an empty response');
      }
      return content.trim();
    },
  };
}

/**
 * Creates an Amazon Bedrock-backed LLM provider.
 *
 * @param accessKeyId - AWS Access Key ID
 * @param secretAccessKey - AWS Secret Access Key
 * @param region - AWS region (e.g., us-east-1)
 * @param model - Bedrock model ID (default: us.anthropic.claude-sonnet-4-20250514-v1:0)
 * @returns LLMProvider instance
 */
export function createBedrockProvider(
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  model: string = 'us.anthropic.claude-sonnet-4-20250514-v1:0'
): LLMProvider {
  const client = new BedrockRuntimeClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return {
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const command = new ConverseCommand({
        modelId: model,
        system: [{ text: systemPrompt }],
        messages: [
          {
            role: 'user',
            content: [{ text: userPrompt }],
          },
        ],
        inferenceConfig: {
          temperature: 0.8,
          maxTokens: 2048,
        },
      });

      const response = await client.send(command);

      const content = response.output?.message?.content?.[0];
      if (!content || !('text' in content) || !content.text) {
        throw new Error('Bedrock returned an empty response');
      }
      return content.text.trim();
    },
  };
}

/**
 * Creates the appropriate LLM provider based on available environment variables.
 * Priority: OPENAI_API_KEY > BEDROCK_ACCESS_KEY_ID
 *
 * @returns LLMProvider instance or undefined if no credentials are configured
 */
export function createLLMProvider(): LLMProvider | undefined {
  // Check for OpenAI first
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (openaiApiKey) {
    const orgId = process.env.OPENAI_ORG_ID;
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    return createOpenAIProvider(openaiApiKey, orgId, model);
  }

  // Check for Bedrock
  const bedrockAccessKey = process.env.BEDROCK_ACCESS_KEY_ID;
  const bedrockSecretKey = process.env.BEDROCK_SECRET_ACCESS_KEY;
  const bedrockRegion = process.env.BEDROCK_REGION;
  if (bedrockAccessKey && bedrockSecretKey && bedrockRegion) {
    const model = process.env.BEDROCK_MODEL || 'us.anthropic.claude-sonnet-4-20250514-v1:0';
    return createBedrockProvider(bedrockAccessKey, bedrockSecretKey, bedrockRegion, model);
  }

  // No LLM configured — will fall back to template-based generation
  return undefined;
}
