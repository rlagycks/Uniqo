import { describe, it, expect } from 'vitest';
import {
  createDAG,
  topologicalSort,
  updateNodeStatus,
  incrementRetry,
  canRetry,
  isDAGComplete,
  hasDAGFailed,
  buildStepLog,
} from './dag.js';
import type { DAGState } from '../types/index.js';

describe('createDAG', () => {
  it('ppt DAG는 4개의 노드를 생성한다', () => {
    const dag = createDAG('ppt');
    expect(dag.nodes.length).toBe(4);
  });

  it('report DAG는 4개의 노드를 생성한다', () => {
    const dag = createDAG('report');
    expect(dag.nodes.length).toBe(4);
  });

  it('notes DAG는 3개의 노드를 생성한다', () => {
    const dag = createDAG('notes');
    expect(dag.nodes.length).toBe(3);
  });

  it('모든 노드는 pending 상태로 시작한다', () => {
    const dag = createDAG('ppt');
    for (const node of dag.nodes) {
      expect(node.status).toBe('pending');
    }
  });

  it('currentNodeId는 첫 번째 노드를 가리킨다', () => {
    const dag = createDAG('ppt');
    expect(dag.currentNodeId).toBe(dag.nodes[0]?.id);
  });

  it('엣지 수는 노드 수 - 1', () => {
    const dag = createDAG('ppt');
    expect(dag.edges.length).toBe(dag.nodes.length - 1);
  });
});

describe('topologicalSort', () => {
  it('순서를 올바르게 반환한다', () => {
    const dag = createDAG('ppt');
    const sorted = topologicalSort(dag);
    expect(sorted.length).toBe(dag.nodes.length);
    // 첫 번째 노드는 parse_attachments
    expect(sorted[0]?.type).toBe('parse_attachments');
    // 마지막 노드는 format_pdf
    expect(sorted[sorted.length - 1]?.type).toBe('format_pdf');
  });

  it('모든 노드가 포함된다', () => {
    const dag = createDAG('report');
    const sorted = topologicalSort(dag);
    const sortedIds = new Set(sorted.map((n) => n.id));
    for (const node of dag.nodes) {
      expect(sortedIds.has(node.id)).toBe(true);
    }
  });
});

describe('updateNodeStatus', () => {
  it('지정 노드의 상태를 변경한다', () => {
    const dag = createDAG('ppt');
    const firstId = dag.nodes[0]!.id;
    const updated = updateNodeStatus(dag, firstId, 'done');
    const node = updated.nodes.find((n) => n.id === firstId);
    expect(node?.status).toBe('done');
  });

  it('done 상태가 되면 currentNodeId가 다음 노드로 이동한다', () => {
    const dag = createDAG('ppt');
    const firstId = dag.nodes[0]!.id;
    const secondId = dag.nodes[1]!.id;
    const updated = updateNodeStatus(dag, firstId, 'done');
    expect(updated.currentNodeId).toBe(secondId);
  });

  it('output을 저장한다', () => {
    const dag = createDAG('ppt');
    const firstId = dag.nodes[0]!.id;
    const updated = updateNodeStatus(dag, firstId, 'done', { papers: 5 });
    const node = updated.nodes.find((n) => n.id === firstId);
    expect(node?.output?.papers).toBe(5);
  });
});

describe('canRetry / incrementRetry', () => {
  it('Research 에이전트는 최대 3회 재시도 가능', () => {
    const dag = createDAG('ppt');
    const researchNode = dag.nodes.find((n) => n.type === 'research')!;
    expect(canRetry(dag, researchNode.id)).toBe(true);
  });

  it('maxRetries 초과 시 canRetry는 false', () => {
    let dag = createDAG('ppt');
    const researchNode = dag.nodes.find((n) => n.type === 'research')!;

    // maxRetries(3)만큼 재시도
    for (let i = 0; i < 3; i++) {
      dag = incrementRetry(dag, researchNode.id);
    }

    expect(canRetry(dag, researchNode.id)).toBe(false);
  });

  it('incrementRetry는 retryCount를 1 증가시킨다', () => {
    const dag = createDAG('ppt');
    const researchNode = dag.nodes.find((n) => n.type === 'research')!;
    const updated = incrementRetry(dag, researchNode.id);
    const node = updated.nodes.find((n) => n.id === researchNode.id);
    expect(node?.retryCount).toBe(1);
  });
});

describe('isDAGComplete / hasDAGFailed', () => {
  it('모든 노드가 done이면 complete', () => {
    let dag = createDAG('notes');
    for (const node of dag.nodes) {
      dag = updateNodeStatus(dag, node.id, 'done');
    }
    expect(isDAGComplete(dag)).toBe(true);
  });

  it('하나라도 pending이면 complete 아님', () => {
    const dag = createDAG('ppt');
    expect(isDAGComplete(dag)).toBe(false);
  });

  it('failed 노드가 있으면 hasDAGFailed는 true', () => {
    const dag = createDAG('ppt');
    const firstId = dag.nodes[0]!.id;
    const updated = updateNodeStatus(dag, firstId, 'failed');
    expect(hasDAGFailed(updated)).toBe(true);
  });
});

describe('buildStepLog', () => {
  it('올바른 구조의 StepLog를 생성한다', () => {
    const log = buildStepLog('research', 'search', '검색 완료', { count: 10 });
    expect(log.agent).toBe('research');
    expect(log.step).toBe('search');
    expect(log.message).toBe('검색 완료');
    expect(log.details?.count).toBe(10);
    expect(log.timestamp).toBeDefined();
  });
});
