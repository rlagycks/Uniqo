import { v4 as uuidv4 } from 'uuid';
import type {
  DAGEdge,
  DAGNode,
  DAGState,
  OutputType,
  AgentType,
  NodeStatus,
  StepLog,
} from '../types/index.js';

// ─── 기본 DAG 템플릿 ────────────────────────────────────────────

type StepType =
  | 'parse_attachments'
  | 'research'
  | 'write_ppt'
  | 'write_report'
  | 'write_notes'
  | 'format_pdf'
  | 'format_docx'
  | 'save_md';

const STEP_AGENT: Record<StepType, AgentType> = {
  parse_attachments: 'orchestrator',
  research: 'research',
  write_ppt: 'writer',
  write_report: 'writer',
  write_notes: 'writer',
  format_pdf: 'formatter',
  format_docx: 'formatter',
  save_md: 'formatter',
};

const RETRY_POLICY: Record<AgentType, number> = {
  orchestrator: 1,
  research: 3,
  writer: 2,
  formatter: 1,
};

const DAG_TEMPLATES: Record<OutputType, StepType[]> = {
  ppt: ['parse_attachments', 'research', 'write_ppt', 'format_pdf'],
  report: ['parse_attachments', 'research', 'write_report', 'format_docx'],
  notes: ['parse_attachments', 'write_notes', 'save_md'],
  research_only: ['parse_attachments', 'research'],
};

export function createDAG(outputType: OutputType): DAGState {
  const steps = DAG_TEMPLATES[outputType];
  const nodes: DAGNode[] = steps.map((type) => ({
    id: uuidv4(),
    type,
    agent: STEP_AGENT[type],
    status: 'pending' as NodeStatus,
    retryCount: 0,
    maxRetries: RETRY_POLICY[STEP_AGENT[type]],
  }));

  const edges: DAGEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  }

  return {
    nodes,
    edges,
    currentNodeId: nodes[0]?.id ?? null,
  };
}

// ─── 위상 정렬 ──────────────────────────────────────────────────

export function topologicalSort(state: DAGState): DAGNode[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of state.nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of state.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    adj.get(edge.from)?.push(edge.to);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    sorted.push(nodeId);
    for (const neighbor of adj.get(nodeId) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));
  return sorted.map((id) => nodeMap.get(id)).filter((n): n is DAGNode => n !== undefined);
}

// ─── DAG 상태 업데이트 헬퍼 ─────────────────────────────────────

export function updateNodeStatus(
  state: DAGState,
  nodeId: string,
  status: NodeStatus,
  output?: Record<string, unknown>,
): DAGState {
  const nodes = state.nodes.map((n) => {
    if (n.id !== nodeId) return n;
    return { ...n, status, output: output ?? n.output };
  });

  // 다음 노드를 currentNode로 설정
  let currentNodeId = state.currentNodeId;
  if (status === 'done') {
    const sorted = topologicalSort({ ...state, nodes });
    const nextNode = sorted.find((n) => n.status === 'pending');
    currentNodeId = nextNode?.id ?? null;
  }

  return { ...state, nodes, currentNodeId };
}

export function incrementRetry(state: DAGState, nodeId: string): DAGState {
  const nodes = state.nodes.map((n) => {
    if (n.id !== nodeId) return n;
    return { ...n, retryCount: n.retryCount + 1, status: 'pending' as NodeStatus };
  });
  return { ...state, nodes };
}

export function canRetry(state: DAGState, nodeId: string): boolean {
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  return node.retryCount < node.maxRetries;
}

export function getNode(state: DAGState, nodeId: string): DAGNode | null {
  return state.nodes.find((n) => n.id === nodeId) ?? null;
}

export function isDAGComplete(state: DAGState): boolean {
  return state.nodes.every((n) => n.status === 'done' || n.status === 'skipped');
}

export function hasDAGFailed(state: DAGState): boolean {
  return state.nodes.some((n) => n.status === 'failed');
}

export function buildStepLog(
  agent: AgentType,
  step: string,
  message: string,
  details?: Record<string, unknown>,
): StepLog {
  return {
    agent,
    step,
    message,
    timestamp: new Date().toISOString(),
    details,
  };
}
