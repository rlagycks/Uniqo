import { preHook } from './hooks/pre.js';
import type { PreHookResult } from './hooks/pre.js';
import { postHook } from './hooks/post.js';
import type { ToolResult } from './hooks/post.js';

export type { ToolResult };

export function wrapTool<T extends Record<string, unknown>>(
  toolName: string,
  handler: (args: T) => Promise<ToolResult>,
  // biome-ignore lint/suspicious/noExplicitAny: MCP SDK 반환 타입 호환성
): (args: T, extra: unknown) => Promise<any> {
  return async (args: T): Promise<ToolResult> => {
    let preResult: PreHookResult;
    try {
      preResult = await preHook(toolName, args as Record<string, unknown>);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `❌ 사전 검증 실패: ${msg}` }],
        isError: true,
      };
    }

    let result: ToolResult;
    try {
      result = await handler(args);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        content: [{ type: 'text', text: `❌ 내부 오류: ${msg}` }],
        isError: true,
      };
    }

    const finalResult = await postHook(toolName, result);

    if (preResult.stateBlock) {
      return {
        ...finalResult,
        content: [
          { type: 'text', text: preResult.stateBlock },
          ...finalResult.content,
        ],
      };
    }

    return finalResult;
  };
}
