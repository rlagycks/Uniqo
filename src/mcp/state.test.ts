import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

// fs 모킹
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockExistsSync = vi.mocked(existsSync);

describe('StateManager', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('파일 없을 때 기본 상태로 시작', async () => {
    mockExistsSync.mockReturnValue(false);
    const { stateManager } = await import('./state.js');
    stateManager.load();
    const state = stateManager.getState();
    expect(state.goal).toBe('');
    expect(state.status).toBe('idle');
    expect(state.milestones).toEqual([]);
    expect(state.retryCount).toBe(0);
  });

  it('파일 파싱 실패 시 기본 상태로 초기화', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('invalid json' as unknown as Buffer);
    const { stateManager } = await import('./state.js');
    stateManager.load();
    expect(stateManager.getState().goal).toBe('');
  });

  it('파일에서 상태 정상 로드', async () => {
    const saved = {
      goal: 'AI 윤리 발표',
      status: 'in_progress',
      startedAt: '2026-01-01T00:00:00Z',
      milestones: [{ name: 'plan_task', status: 'done' }],
      retryCount: 0,
      errors: [],
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(saved) as unknown as Buffer);
    const { stateManager } = await import('./state.js');
    stateManager.load();
    expect(stateManager.getState().goal).toBe('AI 윤리 발표');
  });

  it('setGoal: 목표 설정 후 저장', async () => {
    mockExistsSync.mockReturnValue(false);
    const { stateManager } = await import('./state.js');
    stateManager.load();
    stateManager.setGoal('딥러닝 보고서');
    const state = stateManager.getState();
    expect(state.goal).toBe('딥러닝 보고서');
    expect(state.status).toBe('in_progress');
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('addMilestone → completeMilestone 흐름', async () => {
    mockExistsSync.mockReturnValue(false);
    const { stateManager } = await import('./state.js');
    stateManager.load();
    stateManager.addMilestone('search_papers');
    stateManager.completeMilestone('search_papers');
    const m = stateManager.getState().milestones[0];
    expect(m?.status).toBe('done');
    expect(m?.completedAt).toBeDefined();
  });

  it('addMilestone → failMilestone 흐름', async () => {
    mockExistsSync.mockReturnValue(false);
    const { stateManager } = await import('./state.js');
    stateManager.load();
    stateManager.addMilestone('save_output');
    stateManager.failMilestone('save_output');
    expect(stateManager.getState().milestones[0]?.status).toBe('failed');
  });

  it('retry 증가 및 리셋', async () => {
    mockExistsSync.mockReturnValue(false);
    const { stateManager } = await import('./state.js');
    stateManager.load();
    stateManager.incrementRetry();
    stateManager.incrementRetry();
    expect(stateManager.getState().retryCount).toBe(2);
    stateManager.resetRetry();
    expect(stateManager.getState().retryCount).toBe(0);
  });

  it('addError: 에러 이력 추가', async () => {
    mockExistsSync.mockReturnValue(false);
    const { stateManager } = await import('./state.js');
    stateManager.load();
    stateManager.addError('검색 실패');
    expect(stateManager.getState().errors).toContain('검색 실패');
  });

  it('markDone: 상태를 done으로 변경', async () => {
    mockExistsSync.mockReturnValue(false);
    const { stateManager } = await import('./state.js');
    stateManager.load();
    stateManager.setGoal('테스트 목표');
    stateManager.markDone();
    expect(stateManager.getState().status).toBe('done');
  });

  it('중복 pending 마일스톤 추가 방지', async () => {
    mockExistsSync.mockReturnValue(false);
    const { stateManager } = await import('./state.js');
    stateManager.load();
    stateManager.addMilestone('search_papers');
    stateManager.addMilestone('search_papers');
    expect(stateManager.getState().milestones).toHaveLength(1);
  });
});
