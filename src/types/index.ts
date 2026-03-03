// ============================================================
// uni-agent 공유 타입 정의
// ============================================================

// ------ 기본 결과 타입 ------

export type TaskResult =
  | { status: 'done'; outputPath: string; progress: StepLog[] }
  | { status: 'checkpoint'; checkpointId: string; question: string; options: string[] }
  | { status: 'error'; message: string };

export interface StepLog {
  agent: string;
  step: string;
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

// ------ DAG (Directed Acyclic Graph) 타입 ------

export type AgentType = 'orchestrator' | 'research' | 'writer' | 'formatter';
export type NodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type OutputType = 'ppt' | 'report' | 'notes' | 'research_only';

export interface DAGNode {
  id: string;
  type: string;
  agent: AgentType;
  status: NodeStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
}

export interface DAGEdge {
  from: string;
  to: string;
}

export interface DAGState {
  nodes: DAGNode[];
  edges: DAGEdge[];
  currentNodeId: string | null;
  checkpointId?: string;
}

// ------ 체크포인트 ------

export interface Checkpoint {
  id: string;
  sessionId: string;
  question: string;
  options: string[];
  dagStateSnapshot: DAGState;
  triggerReason: string;
  createdAt: string;
  originalIntent: string;
  originalPreferences?: UserPreferences;
}

// ------ 세션 ------

export interface TaskHistoryEntry {
  taskId: string;
  intent: string;
  outputPath?: string;
  completedAt: string;
  status: 'done' | 'error' | 'checkpoint';
}

export interface SessionState {
  sessionId: string;
  userProfile: UserProfile;
  referenceLibrary: string[];  // refId 목록
  taskHistory: TaskHistoryEntry[];
  currentTask?: CurrentTask;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  preferredLanguage: 'ko' | 'en' | 'mixed';
  university?: string;
  major?: string;
}

export interface CurrentTask {
  intent: string;
  outputType: OutputType;
  dagState: DAGState;
  startedAt: string;
}

// ------ 리서치 ------

export interface PaperSummary {
  refId: string;
  title: string;
  authors: string[];
  year: number;
  relevanceScore: number;
  keyPoints: string[];
  source: 'semantic_scholar' | 'riss' | 'dbpia' | 'tavily' | 'manual';
  doi?: string;
  abstract?: string;
}

export interface ResearchReport {
  papers: PaperSummary[];
  confidence: number;        // 0~1
  gaps: string[];            // 발견된 자료 공백
  searchKeywords: string[];
  totalFound: number;
  iterationCount: number;
}

// ------ 작성 ------

export interface Section {
  title: string;
  content: string;
  refIds: string[];
}

export interface CitationRef {
  refId: string;
  citationKey: string;
  formattedCitation: string;
  context: string;
  sectionTitle: string;
}

export interface Draft {
  outputType: OutputType;
  structure: Section[];
  content: string;           // 전체 마크다운/Marp 마크다운
  selfReviewScore: number;   // 0~1
  citations: CitationRef[];
  title: string;
}

// ------ 레퍼런스 ------

export type ReferenceSource =
  | 'pdf'
  | 'pptx'
  | 'docx'
  | 'image'
  | 'url'
  | 'doi'
  | 'semantic_scholar'
  | 'riss'
  | 'dbpia'
  | 'tavily';

export interface ReferenceEntry {
  id: string;                // ref_001, ref_002, ...
  title: string;
  authors: string[];
  year: number;
  doi?: string;
  url?: string;
  source: ReferenceSource;
  chunkIds: string[];
  usedIn: string[];          // 사용된 섹션/파일 경로
  citationKey: string;       // vaswani2017
  addedAt: string;
  filePath?: string;         // 원본 파일 경로 (로컬 파일인 경우)
}

export interface ReferenceInput {
  type: 'file' | 'url' | 'doi' | 'api_result';
  filePath?: string;
  url?: string;
  doi?: string;
  apiResult?: SemanticScholarPaper | RissPaper | DbpiaPaper | TavilyResult;
}

// ------ 벡터/청킹 ------

export interface Chunk {
  id: string;
  refId: string;
  text: string;
  embedding: number[];
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  chunkIndex: number;
  totalChunks: number;
  section?: string;
  pageNumber?: number;
  slideIndex?: number;
  isAbstract?: boolean;
}

// ------ 외부 API 응답 ------

export interface SemanticScholarPaper {
  paperId: string;
  title: string;
  authors: Array<{ authorId: string; name: string }>;
  year: number;
  abstract?: string;
  externalIds?: { DOI?: string };
  citationCount?: number;
}

export interface SemanticScholarResponse {
  data: SemanticScholarPaper[];
  total: number;
  offset: number;
  next?: number;
}

export interface RissPaper {
  controlNo: string;
  title: string;
  creator: string;
  publisher: string;
  pubtYear: string;
  url: string;
  abstract?: string;
}

export interface RissResponse {
  result: {
    resultCode: string;
    resultMsg: string;
    totalCount: string;
    rows: RissPaper[];
  };
}

export interface DbpiaPaper {
  publicationId: string;
  title: string;
  author: string;
  publishYear: string;
  journalName: string;
  abstract?: string;
  url: string;
}

export interface DbpiaResponse {
  totalCount: number;
  content: DbpiaPaper[];
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

export interface TavilyResponse {
  results: TavilyResult[];
}

// ------ 사용자 환경설정 ------

export interface UserPreferences {
  slideCount?: number;       // PPT 슬라이드 수 (예: 12)
  style?: 'minimal' | 'detailed' | 'academic';
  template?: string;         // templates/ 내 템플릿 이름
  outputFormat?: 'pdf' | 'docx' | 'md';
}

// ------ 에이전트 입력 ------

export interface OrchestratorInput {
  intent: string;
  sessionId: string;
  attachments?: string[];  // 로컬 파일 경로
  preferences?: UserPreferences;
  checkpointAnswer?: {
    checkpointId: string;
    selectedOption: string;
  };
}

export interface ResearchInput {
  topic: string;
  outputType: OutputType;
  sessionId: string;
  existingPapers?: PaperSummary[];
  refinementHint?: string;  // 체크포인트 답변 반영
}

export interface WriterInput {
  researchReport: ResearchReport;
  outputType: OutputType;
  intent: string;
  sessionId: string;
  refinementHint?: string;
  preferences?: UserPreferences;
}

export interface FormatterInput {
  draft: Draft;
  outputType: OutputType;
  outputDir?: string;
  templateName?: string;
}

// ------ 포매터 출력 ------

export interface FormatterOutput {
  outputPath: string;
  format: 'pdf' | 'docx' | 'md';
  sizeBytes: number;
}
