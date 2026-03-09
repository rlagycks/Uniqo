import { stateManager } from '../state.js';
import { buildRecoverySignal, isMaxRetries, MAX_RETRIES } from '../recovery.js';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// 도구 성공 후 다음 단계 안내
const NEXT_STEP: Record<string, string> = {
  plan_task: 'search_papers',
  search_papers: 'register_references',
  register_references: 'save_output (콘텐츠 직접 작성 후)',
  save_output: '완료',
  parse_file: 'search_papers 또는 콘텐츠 직접 작성',
  list_references: '필요한 도구 선택',
};

export async function postHook(
  toolName: string,
  result: ToolResult,
): Promise<ToolResult> {
  const state = stateManager.getState();

  if (result.isError) {
    stateManager.failMilestone(toolName);
    stateManager.incrementRetry();
    stateManager.addError(`[${toolName}] ${result.content[0]?.text ?? '알 수 없는 오류'}`);

    if (isMaxRetries(state.retryCount + 1, MAX_RETRIES)) {
      return {
        content: [{
          type: 'text',
          text: `❌ ${MAX_RETRIES}회 시도 후 실패: ${result.content[0]?.text ?? ''}`,
        }],
        isError: true,
      };
    }

    const recoveryText = buildRecoverySignal(
      result.content[0]?.text ?? '알 수 없는 오류',
      state.retryCount + 1,
      MAX_RETRIES,
    );
    return { content: [{ type: 'text', text: recoveryText }] };
  }

  // 성공
  stateManager.completeMilestone(toolName);
  stateManager.resetRetry();
  if (toolName === 'save_output') {
    stateManager.markDone();
  }

  const nextStep = NEXT_STEP[toolName];
  const isComplete = !nextStep || nextStep === '완료';
  const meta = isComplete
    ? (state.goal ? `\n\n---\n[시스템] 목표 "${state.goal}" 완료` : '')
    : `\n\n---\n[시스템] 현재 목표: "${state.goal}" | 다음 단계: ${nextStep}`;

  if (!meta) return result;

  const last = result.content[result.content.length - 1];
  if (last?.type === 'text') {
    return {
      ...result,
      content: [
        ...result.content.slice(0, -1),
        { type: 'text', text: last.text + meta },
      ],
    };
  }

  return {
    ...result,
    content: [...result.content, { type: 'text', text: meta }],
  };
}
