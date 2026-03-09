# 에이전트 명세 (Agents)

> Fat MCP 패턴 기준 (v3.0.0). MCP 서버가 Pre/Post Hook 레이어로 모든 도구 호출을 감싸며,
> 자율 복구·상태 관리·컨텍스트 주입·역할 분리를 제공한다.
> Claude Desktop AI는 콘텐츠 판단·작성을, MCP 서버는 I/O + 지능형 중간 레이어를 담당한다.

---

## 목차

1. [전체 협업 구조](#1-전체-협업-구조)
2. [MCP 도구 명세 (6개)](#2-mcp-도구-명세-6개)
3. [Hook 레이어](#3-hook-레이어)
4. [Role Router & Persona](#4-role-router--persona)
5. [State Manager](#5-state-manager)
6. [search.ts — 검색 함수](#6-searchts--검색-함수)
7. [Formatter Agent](#7-formatter-agent)
8. [Claude Desktop의 역할](#8-claude-desktop의-역할)

---

## 1. 전체 협업 구조

```
Claude Desktop AI (판단·작성 주체)
  │ 도구 호출
  ▼
┌──────────────────────────────────────────────────┐
│              uni-agent MCP Server                 │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │         Proxy / Hook Layer               │    │
│  │  Pre-Hook:  인자 검증 · 보안 · 컨텍스트  │    │
│  │  Post-Hook: 에러 복구 · 상태 · 메타데이터│    │
│  └──────────────┬───────────────────────────┘    │
│                 │                                │
│  ┌──────────────▼───────────────────────────┐    │
│  │           Role Router                    │    │
│  │  plan_task   → Architect                 │    │
│  │  search_*    → Researcher                │    │
│  │  save_output → Worker                    │    │
│  │  parse/list  → Reader                    │    │
│  └──────────────┬───────────────────────────┘    │
│                 │                                │
│  ┌──────────────▼───────────────────────────┐    │
│  │         I/O 도구 실행 (6개)              │    │
│  │  plan_task / search_papers               │    │
│  │  register_references / save_output       │    │
│  │  list_references / parse_file            │    │
│  └──────────────┬───────────────────────────┘    │
│                 │                                │
│  ┌──────────────▼───────────────────────────┐    │
│  │         State Manager                    │    │
│  │  ~/.uni-agent/state.json                 │    │
│  │  goal · milestones · retryCount · errors │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
  │
  ▼
외부 API (인증 불필요)       파일 출력
Semantic Scholar             PDF (PPT)
OpenAlex                     DOCX (보고서)
CrossRef                     MD (노트)
```

### 이전 방식 vs 현재 방식

```
Thin MCP (v2.0.0 — Phase 4):
  Claude Desktop → search_papers → 결과 반환
  에러 시: LLM이 당황하거나 사용자에게 질문

Fat MCP (v3.0.0 — Phase 5):
  Claude Desktop → [Pre-Hook] → 도구 실행 → [Post-Hook] → 결과 반환
  에러 시: Post-Hook이 복구 신호 주입 → LLM 자동 재시도
```

---

## 2. MCP 도구 명세 (6개)

**파일**: `src/mcp/server.ts`

| 도구 | 역할 | 페르소나 |
|------|------|---------|
| `plan_task` | 목표 설정, 마일스톤 수립, 상태 초기화 | Architect |
| `search_papers` | 학술 논문 검색 (SS + OpenAlex + CrossRef 병렬) | Researcher |
| `register_references` | 선택한 논문을 레퍼런스 DB에 등록 | Researcher |
| `save_output` | 마크다운을 PDF/DOCX/MD로 저장 | Worker |
| `list_references` | 저장된 레퍼런스 라이브러리 조회 | Reader |
| `parse_file` | 첨부파일(PDF/PPTX/DOCX/HWP)에서 텍스트 추출 | Reader |

### 도구 0: `plan_task` (신규)

```typescript
// 입력
{
  goal: string;                                         // 달성할 목표
  output_type?: 'ppt' | 'report' | 'notes' | 'research_only';
  slide_count?: number;                                 // PPT 슬라이드 수
}
// 출력: 마일스톤 계획 + "다음 단계: search_papers" 안내
```

- State Manager에 목표 기록 (`~/.uni-agent/state.json`)
- 출력 유형에 따른 마일스톤 리스트 생성
- Post-Hook이 "다음 단계: search_papers" 메타데이터 첨부

### 도구 1: `search_papers`

```typescript
// 입력
{
  topic: string;
  keywords?: string[];   // 없으면 topic 사용
  limit?: number;        // 기본 15
}
// 출력: PaperResult[] JSON 문자열
```

### 도구 2: `register_references`

```typescript
// 입력
{
  papers: Array<{ title, authors, year, abstract?, doi?, url?, source }>;
}
// 출력: "ref_001: lecun2015 — Deep Learning" 줄 목록
```

### 도구 3: `save_output`

```typescript
// 입력
{
  content: string;
  output_type: 'ppt' | 'report' | 'notes';
  title: string;
  format?: 'pdf' | 'docx' | 'md';
}
// 출력: "저장 완료: ~/Desktop/제목_날짜.pdf (42KB, pdf)"
```

### 도구 4: `list_references`

```typescript
// 입력
{
  source?: 'semantic_scholar' | 'openalex' | 'crossref' | 'pdf' | ...;
  year?: number;
}
// 출력: "📚 참고문헌 목록 (N건)\n\n1. [ref_001] ..."
```

### 도구 5: `parse_file`

```typescript
// 입력
{ file_path: string }   // 절대 경로 필수
// 출력: { text: string (최대 10000자), metadata: {...} } JSON
```

---

## 3. Hook 레이어

**파일**: `src/mcp/hook.ts`, `src/mcp/hooks/pre.ts`, `src/mcp/hooks/post.ts`

모든 도구 호출은 `wrapTool()` 래퍼를 통과한다.

```
Claude AI: search_papers({ topic: "AI 윤리" }) 호출
  │
  ▼ [Pre-Hook: src/mcp/hooks/pre.ts]
  ├─ 경로 탐색(".." 포함) 차단
  ├─ 내부 주소(localhost, 127., 10. 등) 차단
  ├─ Role Router → 페르소나 결정
  ├─ Context Injector → 도구별 컨텍스트 로드
  ├─ plan_task이면 State Manager에 목표 기록
  └─ State Manager에 마일스톤 추가
  │
  ▼ [도구 핸들러 실행]
  └─ searchAll() → PaperResult[]
  │
  ▼ [Post-Hook: src/mcp/hooks/post.ts]
  ├─ isError: false → completeMilestone, resetRetry
  │   └─ 응답에 "다음 단계: register_references" 메타데이터 첨부
  └─ isError: true → failMilestone, incrementRetry
      ├─ retryCount < 3 → 복구 신호 주입 (에러 숨김)
      └─ retryCount >= 3 → 사용자에게 에러 노출
```

### 자율 복구 루프 (Autopilot)

```typescript
// Post-Hook 의사코드 (src/mcp/hooks/post.ts)
if (result.isError) {
  stateManager.failMilestone(toolName);
  stateManager.incrementRetry();
  if (isMaxRetries(state.retryCount + 1)) {
    return { content: [{ text: `❌ 3회 시도 후 실패: ${error}` }], isError: true };
  }
  // 에러를 복구 신호로 교체
  return { content: [{ text: buildRecoverySignal(error, retryCount, 3) }] };
}
// 성공: 다음 단계 안내 주입
return appendNextStepMeta(result, toolName, state.goal);
```

### 보안 검사 (Pre-Hook)

| 검사 항목 | 예시 차단 대상 |
|----------|-------------|
| 경로 탐색 | `../etc/passwd`, `../../secret` |
| 내부 주소 | `localhost`, `127.0.0.1`, `10.0.0.1`, `192.168.x.x` |

---

## 4. Role Router & Persona

**파일**: `src/mcp/role-router.ts`, `src/mcp/personas.ts`

| 페르소나 | 담당 도구 | 설명 |
|---------|---------|------|
| Architect | `plan_task` | 목표 설정, 구조 설계 |
| Researcher | `search_papers`, `register_references` | 논문 검색·등록 |
| Worker | `save_output` | 파일 생성·저장 |
| Reader | `parse_file`, `list_references` | 읽기 전용 |

```typescript
// src/mcp/role-router.ts
getPersona('search_papers')   // → 'researcher'
getPersona('save_output')     // → 'worker'
isAllowed('parse_file', 'reader') // → true
isAllowed('save_output', 'researcher') // → false
```

---

## 5. State Manager

**파일**: `src/mcp/state.ts`
**저장 경로**: `~/.uni-agent/state.json`

```json
{
  "goal": "AI 윤리 발표 12장",
  "status": "in_progress",
  "startedAt": "2026-03-08T10:00:00Z",
  "milestones": [
    { "name": "plan_task", "status": "done", "completedAt": "..." },
    { "name": "search_papers", "status": "done" },
    { "name": "register_references", "status": "pending" }
  ],
  "retryCount": 0,
  "errors": []
}
```

### 주요 메서드

```typescript
stateManager.load()                    // 서버 시작 시 state.json 로드
stateManager.setGoal(goal)             // 목표 설정 (plan_task 시 호출)
stateManager.addMilestone(toolName)    // 도구 호출 시작 기록
stateManager.completeMilestone(name)   // 도구 성공 후 기록
stateManager.failMilestone(name)       // 도구 실패 후 기록
stateManager.incrementRetry()          // retry 카운터 증가
stateManager.resetRetry()             // 성공 시 카운터 리셋
stateManager.markDone()               // save_output 완료 시 status → 'done'
```

---

## 6. search.ts — 검색 함수

**파일**: `src/tools/search.ts`

```typescript
// 3개 API 병렬 검색 + 중복 제거 + limit 적용
export async function searchAll(keywords: string[], _topic: string, limit: number): Promise<PaperResult[]>
export async function searchSemanticScholar(keywords: string[], limit?: number): Promise<PaperResult[]>
export async function searchOpenAlex(keywords: string[], limit?: number): Promise<PaperResult[]>
export async function searchCrossRef(keywords: string[], limit?: number): Promise<PaperResult[]>
export function deduplicatePapers(papers: PaperResult[]): PaperResult[]
```

| API | 용도 | 비용 | 인증 |
|-----|------|------|------|
| Semantic Scholar | 글로벌 논문 2억+ | 무료 | 불필요 |
| OpenAlex | 글로벌 + 한국어 필터 | 무료 | 불필요 |
| CrossRef | DOI 기반 학술 메타데이터 | 무료 | 불필요 |

---

## 7. Formatter Agent

**파일**: `src/agents/formatter.ts`

유일하게 남은 내부 에이전트. `save_output` 도구가 호출한다.

```
PPT 요청: Marp Markdown → @marp-team/marp-cli → PDF
보고서:   Pandoc Markdown → Pandoc CLI → DOCX
노트/리서치: Markdown → 파일 저장
```

| 템플릿 | 용도 |
|--------|------|
| `academic-ppt` | 학부 발표 기본 |
| `team-project` | 팀 프로젝트 발표 |
| `seminar` | 세미나·특강 |
| `minimal` | 미니멀 스타일 |
| `report-standard` | 보고서 기본 양식 |

---

## 8. Claude Desktop의 역할

Fat MCP 패턴에서도 Claude Desktop AI가 직접 수행하는 작업:

| 작업 | 설명 |
|------|------|
| 의도 파악 | 사용자 요청 분석, 출력 유형 결정 |
| 목표 설정 | `plan_task` 호출로 목표 등록 |
| 검색어 생성 | 주제에서 한국어/영문 키워드 도출 |
| 관련성 판단 | `search_papers` 결과 검토, 관련 논문 선별 |
| 콘텐츠 작성 | Marp/보고서 마크다운 직접 작성 |
| 참고문헌 인용 | `register_references`로 받은 citationKey 사용 |
| 파일 저장 지시 | `save_output` 호출로 최종 파일 생성 |

MCP 서버(Hook 레이어)가 담당하는 것:

| 역할 | 파일 |
|------|------|
| 자율 복구 | `src/mcp/hooks/post.ts` |
| 상태 관리 | `src/mcp/state.ts` |
| 컨텍스트 주입 | `src/mcp/context-injector.ts` |
| 역할 분리 | `src/mcp/role-router.ts` |

---

## 9. MCP Prompts (슬래시 명령)

Claude Desktop에서 `/` 입력 시 드롭다운에 나타나는 프롬프트 명령 5개.
v3.0.0부터 각 명령이 `plan_task` 호출을 포함한다.

| 명령 | 인자 | 동작 |
|------|------|------|
| `/ppt` | `topic` | plan_task → search_papers → register → Marp 작성 → save_output(ppt) |
| `/report` | `topic` | plan_task → search_papers → register → 보고서 작성 → save_output(report) |
| `/search` | `topic` | search_papers → 결과 요약 |
| `/notes` | `topic` | parse_file 또는 search_papers → save_output(notes) |
| `/refs` | 없음 | list_references → 전체 목록 출력 |
