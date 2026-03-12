// ============================================================
// uni-agent 공유 타입 정의
// ============================================================

// ------ 기본 유틸 ------

export interface StepLog {
  agent: string;
  step: string;
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

// ------ 출력 타입 ------

export type OutputType = 'ppt' | 'report' | 'notes' | 'research_only';

// ------ 세션 ------

export interface TaskHistoryEntry {
  taskId: string;
  intent: string;
  outputPath?: string;
  completedAt: string;
  status: 'done' | 'error';
}

export interface SessionState {
  sessionId: string;
  userProfile: UserProfile;
  referenceLibrary: string[];  // refId 목록
  taskHistory: TaskHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  preferredLanguage: 'ko' | 'en' | 'mixed';
  university?: string;
  major?: string;
}

// ------ 리서치 ------

/** 검색 API 결과의 정규화된 단일 타입 (Thin MCP 패턴용) */
export interface PaperResult {
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  doi?: string;
  source: 'semantic_scholar' | 'openalex' | 'crossref';
  url?: string;
  citationCount?: number;  // 피인용 횟수 (Semantic Scholar 제공)
  score?: number;          // 다차원 스코어 (0~1, scorePapers() 계산)
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
  | 'openalex'
  | 'crossref';

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
  apiResult?: SemanticScholarPaper | OpenAlexWork | CrossRefWork;
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

export interface OpenAlexWork {
  id: string;          // https://openalex.org/W...
  title: string;
  authorships: Array<{ author: { display_name: string } }>;
  publication_year: number;
  abstract_inverted_index?: Record<string, number[]>;
  doi?: string;
  language?: string;
}

export interface OpenAlexResponse {
  results: OpenAlexWork[];
  meta: { count: number };
}

export interface CrossRefWork {
  DOI: string;
  title: string[];
  author?: Array<{ family: string; given: string }>;
  'published-print'?: { 'date-parts': number[][] };
  abstract?: string;
}

export interface CrossRefResponse {
  message: { items: CrossRefWork[] };
}

// ------ Fat MCP: 상태·Hook ------

export type Persona = 'architect' | 'researcher' | 'worker' | 'reader';

export interface Milestone {
  name: string;
  status: 'pending' | 'done' | 'failed';
  completedAt?: string;
  [key: string]: unknown;
}

export interface AgentState {
  goal: string;
  status: 'idle' | 'in_progress' | 'done' | 'failed';
  startedAt: string;
  milestones: Milestone[];
  retryCount: number;
  errors: string[];
}

export interface HookContext {
  tool: string;
  persona: Persona;
  state: AgentState;
}

// ------ 포매터 입출력 ------

export interface FormatterInput {
  draft: Draft;
  outputType: OutputType;
  outputDir?: string;
  templateName?: string;
}

export interface FormatterOutput {
  outputPath: string;
  format: 'pdf' | 'docx' | 'md';
  sizeBytes: number;
}
