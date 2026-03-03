# uni-agent

**한국 대학생을 위한 멀티 에이전트 학업 자동화 MCP 플러그인**

Claude Desktop에 `npx uni-agent install` 한 줄로 설치. 추가 API 키 불필요.

---

## 이게 뭔가요?

uni-agent는 Claude Desktop에 연결되는 MCP(Model Context Protocol) 플러그인입니다.
발표 자료 만들기, 논문 조사, 보고서 작성 같은 반복 학업 작업을 에이전트가 **스스로 판단하며** 처리합니다.

버튼을 누르는 게 아니라 그냥 말하면 됩니다.

```
사용자: "AI 윤리 기말 발표 12장 만들어줘"

uni-agent:
  📋 계획 수립: PPT 12슬라이드, AI 윤리 주제
  🔍 논문 조사: Semantic Scholar + RISS 병렬 검색 → 8편 선별
  ✍️  초안 작성: 서론→현황→쟁점→사례→결론 구조 설계 → 슬라이드 작성
  🎨 파일 생성: Marp → PDF 변환

  ✅ ~/Desktop/AI_윤리_기말발표_2025-01-15.pdf
  📚 참고문헌 8편 자동 삽입 (APA 형식)
```

---

## 설치

### 요구사항

- [Claude Desktop](https://claude.ai/download) (Claude 구독 필요)
- Node.js v20 이상
- (선택) Pandoc — 보고서 DOCX 출력 시

### 설치 명령

```bash
npx uni-agent install
```

내부에서 자동으로 일어나는 일:
1. OS별 Claude Desktop 설정 파일 경로 자동 감지 (macOS / Windows / Linux)
2. `claude_desktop_config.json`에 MCP 서버 자동 등록
3. 플러그인 디렉토리 초기화 (`~/.uni-agent/plugins/`)
4. Pandoc 설치 여부 확인 및 미설치 안내

이후 Claude Desktop을 재시작하면 바로 사용 가능합니다.

### 선택적 API 키 설정

추가 기능을 원할 때만 설정합니다. 없어도 기본 기능은 동작합니다.

| 환경변수 | 기능 | 비고 |
|---------|------|------|
| `RISS_API_KEY` | 국내 학위논문 검색 (RISS) | 무료 회원가입 |
| `DBPIA_API_KEY` | 국내 학술지 검색 (DBpia) | 대학 구독 기반 |
| `TAVILY_API_KEY` | 일반 웹 검색 | 유료 선택 |
| `VOYAGE_API_KEY` | 고품질 다국어 임베딩 | 유료 선택, 없으면 로컬 fallback |

Claude Desktop 설정 파일에서:

```json
{
  "mcpServers": {
    "uni-agent": {
      "command": "node",
      "args": ["/path/to/uni-agent/dist/server.cjs"],
      "env": {
        "RISS_API_KEY": "your-key",
        "TAVILY_API_KEY": "your-key"
      }
    }
  }
}
```

---

## 사용법

Claude Desktop에서 자연어로 요청하면 됩니다. 도구를 직접 호출할 필요 없습니다.

### PPT 발표자료 만들기

```
"딥러닝 기말 발표 15장 만들어줘"
"AI 윤리 발표 준비해줘" + lecture.pdf 첨부
"탄소중립 정책 팀 프로젝트 발표 자료 만들어줘, academic 스타일로"
```

출력: `~/Desktop/{제목}_{날짜}.pdf`

### 보고서 작성

```
"탄소중립 정책에 대한 5페이지 보고서 써줘"
"이 강의자료 바탕으로 보고서 작성해줘" + lecture.pdf 첨부
"딥러닝 개요 레포트 써줘, 논문체로"
```

출력: `~/Desktop/{제목}_{날짜}.docx` (Pandoc 없으면 `.md`)

### 강의 노트 정리

```
"이 강의 PPT 노트로 정리해줘" + slides.pptx 첨부
"딥러닝 강의 핵심 개념 정리해줘"
```

출력: `~/Desktop/{제목}_{날짜}.md`

### 자료 조사

```
"생성형 AI 관련 최신 논문 조사해줘"
"양자컴퓨팅 국내 연구 동향 알아봐줘"
```

### 레퍼런스 라이브러리 조회

Claude Desktop에서:
```
"저장된 참고문헌 목록 보여줘"
"riss에서 가져온 논문만 보여줘"
"2023년 논문만 보여줘"
```

---

## 핵심 개념

### 에이전트 방식

uni-agent는 버튼/도구 모음이 아니라 **판단하는 에이전트**입니다.

```
❌ 기존 방식 (도구 모음)
사용자 → "논문 검색해줘" → 결과
사용자 → "PPT 만들어줘" → 결과
(단계마다 사용자가 직접 호출)

✅ uni-agent (에이전트 방식)
사용자 → "발표 준비해줘"
에이전트 → 의도 파악 → 논문 조사 → 초안 작성 → PDF 출력
(전체 과정을 에이전트가 스스로 처리)
```

### Human-in-the-loop (체크포인트)

중요한 판단이 불확실할 때만 확인을 요청합니다. 매 단계마다 묻지 않습니다.

```
⏸️ 확인이 필요합니다.

자료 신뢰도가 낮습니다 (45%). 어떻게 진행할까요?

1. 현재 자료로 계속 진행
2. 다른 검색어로 재시도
3. 취소

체크포인트 ID: cp_xxxxxxxx...
```

발동 조건:
- 검색 결과 신뢰도 < 60%
- 수집 논문 < 3편
- 요청 모호도 > 70%

### MCP 도구 (Claude Desktop 노출)

복잡한 내부 구조는 숨기고 3개 도구만 노출합니다.

| 도구 | 역할 |
|------|------|
| `run_task` | 작업 실행 |
| `answer_checkpoint` | 체크포인트 응답 |
| `list_references` | 레퍼런스 조회 |

---

## 아키텍처

```
Claude Desktop (MCP over stdio)
    └── uni-agent MCP Server
            ├── Orchestrator      # 의도 파악, DAG 계획, 체크포인트 판단
            ├── Research Agent    # 4-way 병렬 검색, 관련성 채점, 갭 탐지
            ├── Writer Agent      # 구조 설계, 섹션별 초안, 자체 검토
            ├── Formatter Agent   # Marp→PDF, Pandoc→DOCX, MD 저장
            └── Context Manager   # 벡터 임베딩, RAG, 세션 관리
```

### 데이터 흐름

```
사용자 요청
    ↓
Orchestrator (의도 분류 + DAG 수립)
    ↓
Research Agent (4-way 병렬 검색 → 채점 → 선별)
    ↓ ResearchReport (요약 JSON, 논문 전문 아님)
Writer Agent (RAG로 청크 주입 → 섹션별 작성 → 자체 검토)
    ↓ Draft (Marp/Pandoc 마크다운)
Formatter Agent (CLI 변환 → 파일 저장)
    ↓
출력 파일 (PDF / DOCX / MD)
```

에이전트끼리 논문 전문을 직접 전달하지 않습니다. 구조화된 JSON 요약만 전달하고, 원본이 필요할 때 Vector DB에서 직접 꺼냅니다.

### 데이터 저장 경로

```
~/.uni-agent/
├── references/
│   ├── index.json         ← 레퍼런스 메타데이터
│   └── originals/         ← 원본 파일
├── vector-store/
│   ├── index.bin          ← HNSW 벡터 인덱스
│   └── metadata.json      ← 청크 메타데이터
├── sessions/
│   └── {sessionId}.json   ← 세션 상태
├── checkpoints/
│   ├── {id}.json          ← 체크포인트 데이터
│   └── dag_{sessionId}.json ← DAG 상태
├── plugins/               ← 커뮤니티 플러그인
├── tmp/                   ← 변환 임시 파일
└── embedding-cache.json   ← 임베딩 캐시
```

---

## 기술 스택

| 카테고리 | 기술 | 비고 |
|---------|------|------|
| 런타임 | Node.js v20 LTS | |
| 언어 | TypeScript 5.x | |
| MCP SDK | `@modelcontextprotocol/sdk` | Claude Desktop 연동 표준 |
| LLM | `@anthropic-ai/sdk` (Claude Sonnet 4.6) | 의도 분류, 채점, 작성 |
| PPT 렌더링 | `@marp-team/marp-cli` | Markdown → PDF |
| 문서 변환 | Pandoc (시스템 CLI) | Markdown → DOCX |
| 글로벌 논문 | Semantic Scholar API | 무료, 키 불필요 |
| 국내 논문 | RISS OpenAPI, DBpia OpenAPI | API 키 필요 |
| 웹 검색 | Tavily API | 선택적 유료 |
| 벡터 DB | `hnswlib-node` | 로컬, 서버 불필요 |
| 임베딩 | VoyageAI (`voyage-multilingual-2`) / 로컬 TF fallback | VOYAGE_API_KEY 선택 |
| PDF 파싱 | `pdf-parse` | |
| PPTX 파싱 | `pptx2json` | |
| DOCX 파싱 | `mammoth` | |
| HWP 파싱 | `hwp.js` | graceful fallback 지원 |
| 빌드 | tsup (CJS 포맷) | |
| 테스트 | Vitest | 91개 테스트 |
| 린트 | Biome | |

---

## 개발

### 빌드

```bash
npm install
npm run build      # dist/server.cjs 생성
npm run dev        # watch 모드
```

### 테스트

```bash
npm test           # 91개 테스트 실행
npm run test:watch # watch 모드
```

### 린트

```bash
npm run lint
npm run lint:fix
```

### 테스트 파일 구조

```
src/
├── context/chunker.test.ts
├── context/manager.test.ts
├── reference/citation.test.ts
├── reference/parser.test.ts
├── workflow/dag.test.ts
├── workflow/checkpoint.test.ts
├── agents/writer.test.ts
├── agents/research.test.ts
└── plugins/plugin.test.ts
```

LLM 호출은 모두 `vi.hoisted` + `vi.mock`으로 mock 처리합니다.

---

## 플러그인 SDK

커뮤니티가 직접 파일 파서나 외부 서비스를 확장할 수 있습니다.

```typescript
// ~/.uni-agent/plugins/my-plugin.js 예시
export default {
  name: 'my-parser',
  supportedExtensions: ['.xyz'],
  version: '1.0.0',

  async execute(input) {
    // input.filePath, input.intent, input.sessionId
    const text = parseMyFormat(input.filePath);
    return { success: true, text, metadata: { title: '...' } };
  }
};
```

플러그인은 `pluginRegistry.register(plugin)` 또는 `bin/install.js` 실행 시 자동 탐색됩니다.

---

## 한국 대학 특화 기능

1. **HWP/HWPX 네이티브 지원** — 한국 대학 과제 필수 포맷 (`hwp.js` 연동)
2. **한국 학술 DB 통합** — RISS, DBpia 직접 검색
3. **4-way 병렬 검색** — Semantic Scholar + RISS + DBpia + Tavily 동시 검색
4. **한국어 학술 문체** — `academic` 스타일로 논문체(-이다, -한다) 자동 적용
5. **대학별 커스텀 템플릿** — `templates/` 디렉토리에 Marp/Pandoc 템플릿 추가 가능
6. **추가 비용 없음** — Claude 구독 외 별도 결제 불필요 (API 키는 모두 선택)

---

## 문서

| 문서 | 내용 |
|------|------|
| [`CLAUDE.md`](./CLAUDE.md) | 프로젝트 전체 개요 (Claude Code용) |
| [`agent_docs/agents.md`](./agent_docs/agents.md) | 에이전트 입출력 계약, 내부 로직 |
| [`agent_docs/context.md`](./agent_docs/context.md) | 토큰 예산, RAG, 임베딩 설계 |
| [`agent_docs/reference.md`](./agent_docs/reference.md) | 파일 파싱, 레퍼런스 저장 구조 |
| [`agent_docs/workflow.md`](./agent_docs/workflow.md) | DAG 실행, 체크포인트 생명주기 |
| [`docs/기획.md`](./docs/기획.md) | 전체 기획 문서 (Why + 의사결정 로그) |

---

## 라이선스

MIT

---

*Claude 구독 중인 대학생이라면 추가 비용 없이 지금 바로 시작할 수 있습니다.*
