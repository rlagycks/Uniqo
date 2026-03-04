import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type LLMCaller = (prompt: string, maxTokens?: number) => Promise<string>;

export function createSamplingCaller(mcpServer: McpServer): LLMCaller {
  return async (prompt: string, maxTokens = 1024): Promise<string> => {
    const result = await mcpServer.server.createMessage({
      messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
      maxTokens,
    });
    if (result.content.type === 'text') {
      return result.content.text;
    }
    return '';
  };
}
