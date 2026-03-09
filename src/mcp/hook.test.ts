import { describe, it, expect, vi, beforeEach } from 'vitest';

// 의존성 모킹
vi.mock('./hooks/pre.js', () => ({
  preHook: vi.fn().mockResolvedValue({ contextNote: '', persona: 'researcher' }),
}));

vi.mock('./hooks/post.js', () => ({
  postHook: vi.fn().mockImplementation((_name, result) => Promise.resolve(result)),
}));

vi.mock('./context-injector.js', () => ({
  contextInjector: { init: vi.fn(), getContext: vi.fn().mockReturnValue('') },
}));

vi.mock('./state.js', () => ({
  stateManager: {
    load: vi.fn(),
    getState: vi.fn().mockReturnValue({ goal: '', retryCount: 0, milestones: [], errors: [] }),
    setGoal: vi.fn(),
    addMilestone: vi.fn(),
    completeMilestone: vi.fn(),
    failMilestone: vi.fn(),
    incrementRetry: vi.fn(),
    resetRetry: vi.fn(),
    addError: vi.fn(),
    markDone: vi.fn(),
  },
}));

import { preHook } from './hooks/pre.js';
import { postHook } from './hooks/post.js';
import { wrapTool } from './hook.js';

const mockPreHook = vi.mocked(preHook);
const mockPostHook = vi.mocked(postHook);

describe('wrapTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostHook.mockImplementation((_name, result) => Promise.resolve(result));
  });

  it('정상 흐름: preHook → handler → postHook 순서로 실행', async () => {
    const calls: string[] = [];
    mockPreHook.mockImplementation(async () => {
      calls.push('pre');
      return { contextNote: '', persona: 'researcher' };
    });
    mockPostHook.mockImplementation(async (_name, result) => {
      calls.push('post');
      return result;
    });

    const handler = vi.fn().mockImplementation(async () => {
      calls.push('handler');
      return { content: [{ type: 'text', text: '성공' }] };
    });

    const wrapped = wrapTool('search_papers', handler);
    const result = await wrapped({ topic: '딥러닝' });

    expect(calls).toEqual(['pre', 'handler', 'post']);
    expect(result.content[0]?.text).toBe('성공');
  });

  it('preHook 보안 예외 → isError: true 반환, handler 미실행', async () => {
    mockPreHook.mockRejectedValue(new Error('보안: ".."이 포함될 수 없습니다.'));
    const handler = vi.fn();

    const wrapped = wrapTool('parse_file', handler);
    const result = await wrapped({ file_path: '../etc/passwd' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('사전 검증 실패');
    expect(handler).not.toHaveBeenCalled();
    expect(mockPostHook).not.toHaveBeenCalled();
  });

  it('handler 예외 → isError: true로 postHook 호출', async () => {
    mockPreHook.mockResolvedValue({ contextNote: '', persona: 'worker' });
    const handler = vi.fn().mockRejectedValue(new Error('파일 저장 실패'));
    mockPostHook.mockResolvedValue({
      content: [{ type: 'text', text: '복구 신호' }],
    });

    const wrapped = wrapTool('save_output', handler);
    const result = await wrapped({ content: '', output_type: 'ppt', title: 'test' });

    expect(mockPostHook).toHaveBeenCalledWith(
      'save_output',
      expect.objectContaining({ isError: true }),
    );
    expect(result.content[0]?.text).toBe('복구 신호');
  });

  it('handler 성공 → postHook에 isError 없는 결과 전달', async () => {
    const successResult = { content: [{ type: 'text', text: '완료' }] };
    const handler = vi.fn().mockResolvedValue(successResult);

    const wrapped = wrapTool('search_papers', handler);
    await wrapped({ topic: 'AI' });

    expect(mockPostHook).toHaveBeenCalledWith(
      'search_papers',
      expect.not.objectContaining({ isError: true }),
    );
  });
});
