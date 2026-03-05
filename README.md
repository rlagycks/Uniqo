# uni-agent

**한국 대학생을 위한 학업 자동화 MCP 플러그인**

Claude Desktop에 `npx uni-agent install` 한 줄로 설치. 추가 API 키 불필요.

---

## 이게 뭔가요?

uni-agent는 Claude Desktop에 연결되는 MCP(Model Context Protocol) 플러그인입니다.
발표 자료 만들기, 논문 조사, 보고서 작성 같은 반복 학업 작업을 에이전트가 **스스로 판단하며** 처리합니다.

버튼을 누르는 게 아니라 그냥 말하면 됩니다.

```
사용자: "AI 윤리 기말 발표 12장 만들어줘"

Claude Desktop AI가 스스로:
  🔍 search_papers("AI 윤리") → 논문 15편 수신, 관련 6편 선별
  📋 register_references([...6편...]) → ref_001~ref_006 등록
  ✍️  Marp 마크다운 12장 직접 작성
  💾 save_output(ppt) → ~/Desktop/AI_윤리_기말발표_2026-03-05.pdf
  📚 참고문헌 6편 자동 삽입 (APA 형식)
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

> **추가 API 키 없음** — 검색(Semantic Scholar · OpenAlex · CrossRef)과 임베딩(`@xenova/transformers`)이 모두 무료·로컬로 동작합니다. 추가 설정 불필요.

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

### MCP 도구 (Claude Desktop 노출)

5개 도구를 노출합니다. Claude Desktop AI가 직접 순서를 판단하며 호출합니다.

| 도구 | 역할 |
|------|------|
| `search_papers` | 학술 논문 검색 (SS + OpenAlex + CrossRef 병렬) |
| `register_references` | 선택한 논문을 레퍼런스 DB에 등록 |
| `save_output` | 마크다운을 PDF/DOCX/MD로 변환·저장 |
| `list_references` | 저장된 레퍼런스 라이브러리 조회 |
| `parse_file` | 첨부파일(PDF/PPTX/DOCX/HWP) 텍스트 추출 |

### 슬래시 명령 (Claude Desktop)

Claude Desktop에서 `/` 입력 시 드롭다운에서 빠르게 시작할 수 있습니다.

| 명령 | 동작 |
|------|------|
| `/ppt <topic>` | 논문 검색 → 등록 → Marp 12슬라이드 → PDF 저장 |
| `/report <topic>` | 논문 검색 → 등록 → 보고서 → DOCX 저장 |
| `/search <topic>` | 논문 검색 후 결과 요약 |
| `/notes <topic>` | 주제 또는 파일로 학습 노트 → 저장 |
| `/refs` | 등록된 참고문헌 목록 조회 |

---

## 아키텍처

```
Claude Desktop AI (판단·작성 주체)
    └── uni-agent MCP Server (I/O 도구 5개)
            ├── search_papers       → src/tools/search.ts (SS + OpenAlex + CrossRef)
            ├── register_references → src/reference/store.ts
            ├── save_output         → src/agents/formatter.ts (Marp→PDF, Pandoc→DOCX)
            ├── list_references     → src/reference/store.ts
            └── parse_file          → src/reference/parser.ts
```

### 데이터 흐름

```
사용자: "AI 윤리 발표 준비해줘"
    ↓
Claude Desktop AI (의도 파악, 논문 선별, 마크다운 작성)
    ↓ search_papers → 논문 15편 수신
    ↓ register_references → 6편 등록 (ref_001~ref_006)
    ↓ [Marp 마크다운 12장 직접 작성]
    ↓ save_output(ppt) → Formatter Agent 호출
    ↓
출력 파일 (PDF / DOCX / MD)
```

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
| LLM | Claude Desktop AI 자신 (Thin MCP) | 판단·작성, MCP 서버에서 LLM 호출 없음 |
| PPT 렌더링 | `@marp-team/marp-cli` | Markdown → PDF |
| 문서 변환 | Pandoc (시스템 CLI) | Markdown → DOCX |
| 글로벌 논문 | Semantic Scholar · OpenAlex · CrossRef | 무료, 키 불필요 |
| 벡터 DB | `hnswlib-node` | 로컬, 서버 불필요 |
| 임베딩 | `@xenova/transformers` (`multilingual-e5-base`, 768차원) | 로컬, API 키 불필요, TF-IDF fallback |
| PDF 파싱 | `pdf-parse` | |
| PPTX 파싱 | `pptx2json` | |
| DOCX 파싱 | `mammoth` | |
| HWP 파싱 | `hwp.js` | graceful fallback 지원 |
| 빌드 | tsup (CJS 포맷) | |
| 테스트 | Vitest | 57개 테스트 |
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
npm test           # 57개 테스트 실행
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
├── tools/search.test.ts
├── context/chunker.test.ts
├── context/manager.test.ts
├── reference/citation.test.ts
├── reference/parser.test.ts
└── plugins/plugin.test.ts
```

외부 API(fetch)와 `@xenova/transformers`는 `vi.mock`으로 mock 처리합니다.

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
2. **한국어 논문 지원** — OpenAlex 한국어 필터 통합 (API 키 불필요)
3. **3-way 병렬 검색** — Semantic Scholar + OpenAlex + CrossRef 동시 검색, 모두 무료
4. **한국어 학술 문체** — `academic` 스타일로 논문체(-이다, -한다) 자동 적용
5. **대학별 커스텀 템플릿** — `templates/` 디렉토리에 Marp/Pandoc 템플릿 추가 가능
6. **추가 비용 없음** — Claude 구독 외 별도 결제 불필요 (API 키는 모두 선택)

---

## 문서

| 문서 | 내용 |
|------|------|
| [`CLAUDE.md`](./CLAUDE.md) | 프로젝트 전체 개요 (Claude Code용) |
| [`agent_docs/agents.md`](./agent_docs/agents.md) | MCP 도구 5개 명세, Formatter Agent, search.ts |
| [`agent_docs/context.md`](./agent_docs/context.md) | 토큰 예산, RAG, 임베딩 설계 |
| [`agent_docs/reference.md`](./agent_docs/reference.md) | 파일 파싱, 레퍼런스 저장 구조 |
| [`agent_docs/workflow.md`](./agent_docs/workflow.md) | Thin MCP 워크플로우, 도구 호출 순서 |
| [`docs/기획.md`](./docs/기획.md) | 전체 기획 문서 (Why + 의사결정 로그) |

---

## 라이선스

MIT

---

*Claude 구독 중인 대학생이라면 추가 비용 없이 지금 바로 시작할 수 있습니다.*
