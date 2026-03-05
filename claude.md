# uni-agent

한국 대학생을 위한 학업 자동화 MCP 플러그인.
`npx uni-agent install` 한 줄로 Claude Desktop에 설치. 추가 API 키 불필요.

## 프로젝트의 본질

**Thin MCP 패턴**: MCP 서버는 I/O 도구만 제공하고, Claude Desktop AI가 직접 판단하고 콘텐츠를 작성한다.

```
사용자: "AI 윤리 발표 준비해줘"
→ Claude Desktop AI가 직접:
    search_papers("AI 윤리") → 논문 15편 수신
    관련 6편 선별 (AI 자신이 판단)
    register_references([...6편...]) → ref_001~ref_006 등록
    Marp 마크다운 직접 작성 (12장)
    save_output(ppt) → ~/Desktop/AI_윤리_발표.pdf
```

Claude Desktop에 노출되는 도구는 5개:
`search_papers`, `register_references`, `save_output`, `list_references`, `parse_file`

## 아키텍처

```
Claude Desktop AI (판단·작성 주체)
    └── uni-agent MCP Server (I/O 도구 5개 제공)
            ├── src/tools/search.ts   # SS + OpenAlex + CrossRef 병렬 검색
            ├── src/reference/        # parser, store, citation
            ├── src/agents/
            │   └── formatter.ts      # Marp→PDF, Pandoc→DOCX (유일한 내부 에이전트)
            ├── src/context/          # manager, chunker, vector-store (768차원)
            └── src/mcp/server.ts     # 도구 5개 등록
```

외부 연결: Semantic Scholar (무료) · OpenAlex (무료, 한국어 필터) · CrossRef (무료)

## 기술 스택

- **언어**: TypeScript / Node.js v20 LTS
- **MCP**: `@modelcontextprotocol/sdk` (Thin MCP 패턴 — 서버에서 LLM 호출 없음)
- **임베딩**: `@xenova/transformers` (로컬 신경망, `multilingual-e5-base`, 768차원) — API 키 불필요
- **PPT**: `@marp-team/marp-cli` → PDF
- **문서**: Pandoc (시스템 CLI) → DOCX / PDF
- **벡터 DB**: `hnswlib-node` (로컬)
- **빌드**: tsup (CJS) · **테스트**: Vitest · **린트**: Biome

## 핵심 타입

공유 타입 전체는 `src/types/index.ts` 참조.
가장 중요한 것만:

```typescript
// 검색 결과 정규화 타입
interface PaperResult {
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  doi?: string;
  source: 'semantic_scholar' | 'openalex' | 'crossref';
  url?: string;
}

// Formatter Agent 입출력
interface Draft {
  outputType: OutputType;    // 'ppt' | 'report' | 'notes' | 'research_only'
  structure: Section[];
  content: string;           // Claude AI가 작성한 마크다운
  selfReviewScore: number;
  citations: CitationRef[];
  title: string;
}
```

## 디렉토리

```
src/
  mcp/server.ts          # Claude 연결 지점. 도구 5개 노출
  tools/search.ts        # searchAll, searchSS, searchOA, searchCR, dedup
  agents/
    formatter.ts         # Marp→PDF, Pandoc→DOCX (내부 에이전트)
  context/               # manager, chunker, vector-store
  reference/             # parser, store, citation
  plugins/               # PluginRegistry (서드파티 확장)
  types/index.ts         # 공유 타입 (슬림화됨)
bin/install.js           # npx 진입점
templates/               # 한국 대학 PPT·보고서 양식
```

## 세부 문서

| 문서 | 내용 |
|------|------|
| `agent_docs/agents.md` | MCP 도구 5개 명세, Formatter Agent, search.ts |
| `agent_docs/context.md` | 청킹 전략, Vector Store(768차원), 임베딩, 세션 |
| `agent_docs/reference.md` | 파일 파싱, 레퍼런스 저장 구조, 인용 추적 |
| `agent_docs/workflow.md` | Thin MCP 워크플로우, 도구 호출 순서 |
| `docs/기획.md` | 전체 기획 문서 (Why + 의사결정 로그) |

## 현재 상태

- [x] Phase 1: MCP Hello World → PPT → 보고서 → 설치 마법사 → v0.1.0
- [x] Phase 2: Research Agent · Context Manager · 체크포인트
- [x] Phase 3: 플러그인 SDK · HWP 지원 · v1.0.0
- [x] Phase 4: 외부 API 무의존 · 로컬 임베딩 · Thin MCP 리팩토링 → v2.0.0
- [ ] Phase 5: 커뮤니티 · 스킬 디렉토리 · npm 배포
