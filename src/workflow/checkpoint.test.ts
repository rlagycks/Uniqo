import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CheckpointManager, buildRefinementHint } from './checkpoint.js';
import { createDAG } from './dag.js';

describe('buildRefinementHint', () => {
  it('"재시도" 포함 시 검색어 변경 힌트 반환', () => {
    expect(buildRefinementHint('다른 검색어로 재시도')).toBe('다른 검색어로 더 넓게 검색하세요');
  });

  it('"재시도" 단독 포함 시 힌트 반환', () => {
    expect(buildRefinementHint('재시도')).toBe('다른 검색어로 더 넓게 검색하세요');
  });

  it('"현재 자료로 계속 진행" 시 낮은 신뢰도 힌트 반환', () => {
    expect(buildRefinementHint('현재 자료로 계속 진행')).toBe(
      '현재 결과로 진행하되 신뢰도가 낮음을 초안에 명시하세요',
    );
  });

  it('"계속" 포함 시 낮은 신뢰도 힌트 반환', () => {
    expect(buildRefinementHint('계속 진행')).toBe(
      '현재 결과로 진행하되 신뢰도가 낮음을 초안에 명시하세요',
    );
  });

  it('"최신" 포함 시 최신 논문 힌트 반환', () => {
    expect(buildRefinementHint('최신 논문으로 재검색')).toBe('2022년 이후 논문 위주로 검색하세요');
  });

  it('"이론" 포함 시 고전 자료 힌트 반환', () => {
    expect(buildRefinementHint('이론적 기반 자료 포함')).toBe(
      '고전 논문과 이론적 기반 자료를 포함하세요',
    );
  });

  it('"고전" 포함 시 고전 자료 힌트 반환', () => {
    expect(buildRefinementHint('고전 논문 포함')).toBe(
      '고전 논문과 이론적 기반 자료를 포함하세요',
    );
  });

  it('매칭되지 않는 옵션은 빈 문자열 반환', () => {
    expect(buildRefinementHint('취소')).toBe('');
    expect(buildRefinementHint('알 수 없는 옵션')).toBe('');
  });
});

describe('CheckpointManager', () => {
  let testDir: string;
  let manager: CheckpointManager;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `uni-agent-cp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    manager = new CheckpointManager(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('createCheckpoint', () => {
    it('체크포인트를 생성하고 UUID를 반환한다', () => {
      const dagState = createDAG('ppt');
      const cp = manager.createCheckpoint(
        'session-123',
        '어떻게 진행할까요?',
        ['옵션1', '옵션2'],
        dagState,
        'test reason',
        '딥러닝 발표 만들어줘',
      );

      expect(cp.id).toBeDefined();
      expect(cp.id.length).toBeGreaterThan(0);
      expect(cp.sessionId).toBe('session-123');
      expect(cp.question).toBe('어떻게 진행할까요?');
      expect(cp.options).toEqual(['옵션1', '옵션2']);
      expect(cp.originalIntent).toBe('딥러닝 발표 만들어줘');
    });

    it('체크포인트 파일이 저장된다', () => {
      const dagState = createDAG('ppt');
      const cp = manager.createCheckpoint('s1', 'Q?', ['A', 'B'], dagState, 'reason', 'test intent');

      const filePath = path.join(testDir, `${cp.id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('originalPreferences가 저장된다', () => {
      const dagState = createDAG('ppt');
      const cp = manager.createCheckpoint(
        's4',
        'Q?',
        ['A'],
        dagState,
        'reason',
        'AI 발표',
        { slideCount: 12, style: 'academic' },
      );

      const retrieved = manager.getCheckpoint(cp.id);
      expect(retrieved?.originalPreferences?.slideCount).toBe(12);
      expect(retrieved?.originalPreferences?.style).toBe('academic');
    });
  });

  describe('getCheckpoint', () => {
    it('존재하는 체크포인트를 반환한다', () => {
      const dagState = createDAG('report');
      const cp = manager.createCheckpoint('s2', 'Q?', ['A'], dagState, 'reason', 'test intent');

      const retrieved = manager.getCheckpoint(cp.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(cp.id);
    });

    it('존재하지 않는 ID는 null 반환', () => {
      const result = manager.getCheckpoint('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('saveState / restoreState', () => {
    it('DAG 상태를 저장하고 복원한다', () => {
      const dag = createDAG('ppt');
      manager.saveState('session-xyz', dag);

      const restored = manager.restoreState('session-xyz');
      expect(restored).not.toBeNull();
      expect(restored?.nodes.length).toBe(dag.nodes.length);
    });

    it('존재하지 않는 세션은 null 반환', () => {
      const result = manager.restoreState('nonexistent-session');
      expect(result).toBeNull();
    });
  });

  describe('applyAnswer', () => {
    it('답변 적용 후 체크포인트 파일이 삭제된다', () => {
      const dagState = createDAG('ppt');
      const cp = manager.createCheckpoint('s3', 'Q?', ['계속 진행'], dagState, 'reason', 'test intent');

      const filePath = path.join(testDir, `${cp.id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);

      manager.applyAnswer(cp.id, '계속 진행');
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('올바른 세션 ID와 DAG 상태를 반환한다', () => {
      const dagState = createDAG('ppt');
      const cp = manager.createCheckpoint('session-abc', 'Q?', ['옵션1'], dagState, 'reason', '원래 의도');

      const result = manager.applyAnswer(cp.id, '옵션1');
      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe('session-abc');
      expect(result?.selectedOption).toBe('옵션1');
    });

    it('originalIntent와 refinementHint를 반환한다', () => {
      const dagState = createDAG('ppt');
      const cp = manager.createCheckpoint(
        'session-xyz',
        '어떻게 진행할까요?',
        ['다른 검색어로 재시도'],
        dagState,
        'reason',
        'AI 윤리 발표 만들어줘',
      );

      const result = manager.applyAnswer(cp.id, '다른 검색어로 재시도');
      expect(result?.originalIntent).toBe('AI 윤리 발표 만들어줘');
      expect(result?.refinementHint).toBe('다른 검색어로 더 넓게 검색하세요');
    });

    it('존재하지 않는 체크포인트는 null 반환', () => {
      const result = manager.applyAnswer('bad-id', 'option');
      expect(result).toBeNull();
    });
  });
});
