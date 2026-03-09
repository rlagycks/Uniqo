import { contextInjector } from '../context-injector.js';
import { getPersona } from '../role-router.js';
import { stateManager } from '../state.js';
import type { Persona } from '../../types/index.js';

// Private IP 대역 차단 (SSRF 방지)
const PRIVATE_IP_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

export interface PreHookResult {
  contextNote: string;
  persona: Persona;
}

export async function preHook(
  toolName: string,
  args: Record<string, unknown>,
): Promise<PreHookResult> {
  // 1. 경로 탐색 차단
  if (typeof args['file_path'] === 'string' && args['file_path'].includes('..')) {
    throw new Error('보안: 파일 경로에 ".."이 포함될 수 없습니다.');
  }

  // 2. 내부 주소 차단
  for (const field of ['url', 'file_path']) {
    const val = args[field];
    if (typeof val === 'string' && PRIVATE_IP_RE.test(val)) {
      throw new Error(`보안: 내부 주소(${val})에 대한 접근은 허용되지 않습니다.`);
    }
  }

  // 3. 역할 결정
  const persona = getPersona(toolName);

  // 4. 컨텍스트 로드
  const contextNote = contextInjector.getContext(toolName);

  // 5. plan_task: 목표 설정
  if (toolName === 'plan_task' && typeof args['goal'] === 'string') {
    stateManager.setGoal(args['goal']);
  }

  // 6. 마일스톤 추가
  stateManager.addMilestone(toolName);

  return { contextNote, persona };
}
