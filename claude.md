# uni-agent

한국 대학생을 위한 멀티 에이전트 학업 자동화 MCP 플러그인.
`npx uni-agent install` 한 줄로 Claude Desktop에 설치. 추가 API 키 불필요.

## 프로젝트의 본질

도구를 호출하는 게 아니라 **에이전트가 판단한다**.

```
사용자: "AI 윤리 발표 준비해줘"
→ Orchestrator가 계획 수립
→ Research Agent가 논문 조사 (자체 루프, 최대 3회)
→ Writer Agent가 구성 설계 + 초안 작성 + 자체 검토
→ Formatter Agent가 Marp → PDF 출력
```

Claude Desktop에 노출되는 도구는 `run_task`, `answer_checkpoint`, `list_references` 셋뿐.
내부 에이전트 구조는 사용자에게 노출하지 않는다.

## 아키텍처

```
Claude Desktop (MCP over stdio)
    └── uni-agent MCP Server
            ├── Orchestrator      # 지휘, DAG 계획, 체크포인트 판단
            ├── Research Agent    # 검색, 관련성 채점, 갭 탐지
            ├── Writer Agent      # 구조 설계, 초안, 자체 검토
            ├── Formatter Agent   # Marp→PDF, Pandoc→DOCX
            └── Context Manager   # Vector Store, 토큰 예산, 세션
```

외부 연결: Semantic Scholar (필수) · RISS (국내 논문) · Tavily (선택, 웹 검색)

## 기술 스택

- **언어**: TypeScript / Node.js v20 LTS
- **MCP**: `@modelcontextprotocol/sdk`
- **LLM**: `@anthropic-ai/sdk` (Claude Desktop 환경에서 키 자동 주입)
- **PPT**: `@marp-team/marp-cli` → PDF
- **문서**: Pandoc (시스템 CLI) → DOCX / PDF
- **벡터 DB**: `hnswlib-node` (로컬)
- **빌드**: tsup · **테스트**: Vitest · **린트**: Biome

## 핵심 타입

공유 타입 전체는 `src/types/index.ts` 참조.
가장 중요한 것만:

```typescript
// 모든 에이전트 작업의 결과
type TaskResult =
  | { status: 'done';       outputPath: string; progress: StepLog[] }
  | { status: 'checkpoint'; checkpointId: string; question: string; options: string[] }
  | { status: 'error';      message: string }

// 체크포인트 발동 조건 (orchestrator.ts)
// research.confidence < 0.6 || papers.length < 3
// plan.ambiguityScore > 0.7  || gaps.length > 2
```

## 디렉토리

```
src/
  mcp/server.ts          # Claude 연결 지점. 도구 3개만 노출
  agents/                # orchestrator, research, writer, formatter
  context/               # manager, chunker, vector-store
  reference/             # parser, store, citation
  workflow/              # dag, checkpoint
  types/index.ts         # 공유 타입
bin/install.js           # npx 진입점
templates/               # 한국 대학 PPT·보고서 양식
```

## 세부 문서

| 문서 | 내용 |
|------|------|
| `agent_docs/agents.md` | 각 에이전트 입출력 계약, 내부 로직 명세 |
| `agent_docs/context.md` | 토큰 예산, 청킹 전략, RAG 설계 |
| `agent_docs/reference.md` | 파일 파싱, 레퍼런스 저장 구조, 인용 추적 |
| `agent_docs/workflow.md` | DAG 실행, 체크포인트 생명주기 |
| `uni-agent-planning.md` | 전체 기획 문서 (Why + 의사결정 로그) |

## 현재 상태

- [x] Phase 1: MCP Hello World → PPT → 보고서 → 설치 마법사 → v0.1.0
- [x] Phase 2: Research Agent · Context Manager · 체크포인트
- [x] Phase 3: 플러그인 SDK · HWP 지원 · v1.0.0
