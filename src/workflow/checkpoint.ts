import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import type { Checkpoint, DAGState, UserPreferences } from '../types/index.js';

const DEFAULT_CHECKPOINT_DIR = path.join(os.homedir(), '.uni-agent', 'checkpoints');

/**
 * 사용자가 선택한 체크포인트 옵션을 다음 에이전트에 전달할 힌트 문자열로 변환
 */
export function buildRefinementHint(option: string): string {
  if (option.includes('재시도') || option.includes('다른 검색어')) {
    return '다른 검색어로 더 넓게 검색하세요';
  }
  if (option.includes('현재 자료') || option.includes('계속')) {
    return '현재 결과로 진행하되 신뢰도가 낮음을 초안에 명시하세요';
  }
  if (option.includes('최신')) {
    return '2022년 이후 논문 위주로 검색하세요';
  }
  if (option.includes('이론') || option.includes('고전')) {
    return '고전 논문과 이론적 기반 자료를 포함하세요';
  }
  return '';
}

export class CheckpointManager {
  private checkpointDir: string;

  constructor(checkpointDir?: string) {
    this.checkpointDir = checkpointDir ?? DEFAULT_CHECKPOINT_DIR;
    fs.mkdirSync(this.checkpointDir, { recursive: true });
  }

  /**
   * 체크포인트 생성 + 저장. UUID를 반환한다.
   */
  createCheckpoint(
    sessionId: string,
    question: string,
    options: string[],
    dagState: DAGState,
    triggerReason: string,
    originalIntent: string,
    originalPreferences?: UserPreferences,
  ): Checkpoint {
    const checkpoint: Checkpoint = {
      id: uuidv4(),
      sessionId,
      question,
      options,
      dagStateSnapshot: dagState,
      triggerReason,
      createdAt: new Date().toISOString(),
      originalIntent,
      originalPreferences,
    };

    this.save(checkpoint);
    return checkpoint;
  }

  /**
   * DAG 상태 저장 (체크포인트와 별도로 세션 단위 저장)
   */
  saveState(sessionId: string, dagState: DAGState): void {
    const filePath = path.join(this.checkpointDir, `dag_${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(dagState, null, 2), 'utf-8');
  }

  /**
   * DAG 상태 복원
   */
  restoreState(sessionId: string): DAGState | null {
    const filePath = path.join(this.checkpointDir, `dag_${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DAGState;
  }

  /**
   * 체크포인트 조회
   */
  getCheckpoint(checkpointId: string): Checkpoint | null {
    const filePath = path.join(this.checkpointDir, `${checkpointId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Checkpoint;
  }

  /**
   * 사용자 답변을 반영해 DAG 상태에 컨텍스트 추가 후 재개 준비
   */
  applyAnswer(
    checkpointId: string,
    selectedOption: string,
  ): {
    dagState: DAGState;
    sessionId: string;
    selectedOption: string;
    originalIntent: string;
    originalPreferences?: UserPreferences;
    refinementHint: string;
  } | null {
    const checkpoint = this.getCheckpoint(checkpointId);
    if (!checkpoint) return null;

    // 현재 노드를 'pending'으로 되돌려 재실행 가능하게 함
    const dagState: DAGState = {
      ...checkpoint.dagStateSnapshot,
      nodes: checkpoint.dagStateSnapshot.nodes.map((n) => {
        if (n.id === checkpoint.dagStateSnapshot.currentNodeId) {
          return { ...n, status: 'pending' as const };
        }
        return n;
      }),
    };

    // 업데이트된 상태 저장
    this.saveState(checkpoint.sessionId, dagState);

    // 체크포인트 파일 삭제 (일회성)
    const filePath = path.join(this.checkpointDir, `${checkpointId}.json`);
    fs.unlinkSync(filePath);

    return {
      dagState,
      sessionId: checkpoint.sessionId,
      selectedOption,
      originalIntent: checkpoint.originalIntent,
      originalPreferences: checkpoint.originalPreferences,
      refinementHint: buildRefinementHint(selectedOption),
    };
  }

  /**
   * 세션의 미처리 체크포인트 목록
   */
  listPending(sessionId: string): Checkpoint[] {
    const files = fs.readdirSync(this.checkpointDir).filter((f) => f.endsWith('.json') && !f.startsWith('dag_'));
    const checkpoints: Checkpoint[] = [];

    for (const file of files) {
      const cp = JSON.parse(
        fs.readFileSync(path.join(this.checkpointDir, file), 'utf-8'),
      ) as Checkpoint;
      if (cp.sessionId === sessionId) {
        checkpoints.push(cp);
      }
    }

    return checkpoints;
  }

  private save(checkpoint: Checkpoint): void {
    const filePath = path.join(this.checkpointDir, `${checkpoint.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  }
}

export const checkpointManager = new CheckpointManager();
