# 워크플로우 (Workflow)

> Fat MCP 패턴 기준 (v3.0.0). MCP 서버가 Pre/Post Hook 레이어로 모든 도구 호출을 감싸며
> 자율 복구·상태 관리를 제공한다. Claude Desktop AI는 콘텐츠 판단·작성을 직접 담당한다.

---

## 목차

1. [MCP 도구 인터페이스 (6개)](#1-mcp-도구-인터페이스-6개)
2. [Hook 감싼 도구 호출 흐름](#2-hook-감싼-도구-호출-흐름)
3. [Claude Desktop 주도 워크플로우](#3-claude-desktop-주도-워크플로우)
4. [도구 호출 순서 예시](#4-도구-호출-순서-예시)
5. [자율 복구 루프 (Autopilot)](#5-자율-복구-루프-autopilot)
6. [State Manager 영속화](#6-state-manager-영속화)

---

## 1. MCP 도구 인터페이스 (6개)

**파일**: `src/mcp/server.ts`

| 도구 | 역할 | 페르소나 |
|------|------|---------|
| `plan_task` *(신규)* | 목표 설정, 마일스톤 수립 | Architect |
| `search_papers` | 학술 논문 검색 (SS + OpenAlex + CrossRef 병렬) | Researcher |
| `register_references` | 선택한 논문을 레퍼런스 DB에 등록 | Researcher |
| `save_output` | 작성한 마크다운을 PDF/DOCX/MD로 저장 | Worker |
| `list_references` | 저장된 레퍼런스 라이브러리 조회 | Reader |
| `parse_file` | 첨부파일(PDF/PPTX/DOCX/HWP)에서 텍스트 추출 | Reader |

### plan_task 스펙 (신규)

```typescript
// 입력
{
  goal: string;                   // "AI 윤리 발표 12장 만들기"
  output_type?: 'ppt' | 'report' | 'notes' | 'research_only';
  slide_count?: number;
}
// 출력: 마일스톤 계획 텍스트 + "다음 단계: search_papers" 안내
// 사이드이펙트: ~/.uni-agent/state.json 에 목표 기록
```

### search_papers 스펙

```typescript
{ topic: string; keywords?: string[]; limit?: number }
// 출력: PaperResult[] JSON
```

### register_references 스펙

```typescript
{ papers: Array<{ title, authors, year, abstract?, doi?, url?, source }> }
// 출력: "ref_001: lecun2015 — Deep Learning" 줄 목록
```

### save_output 스펙

```typescript
{ content: string; output_type: 'ppt'|'report'|'notes'; title: string; format?: 'pdf'|'docx'|'md' }
// 출력: "저장 완료: ~/Desktop/제목_날짜.pdf (42KB, pdf)"
```

---

## 2. Hook 감싼 도구 호출 흐름

모든 도구는 `wrapTool()` 래퍼(`src/mcp/hook.ts`)를 통과한다.

```
Claude AI: plan_task({ goal: "AI 윤리 발표 12장" }) 호출
  │
  ▼ [Pre-Hook: src/mcp/hooks/pre.ts]
  ├─ 인자 보안 검사 (경로 탐색, 내부 주소 차단)
  ├─ Role Router → Architect 페르소나 결정
  ├─ Context Injector → CLAUDE.md / README.md 컨텍스트 로드
  ├─ State Manager: setGoal("AI 윤리 발표 12장")
  └─ State Manager: addMilestone("plan_task")
  │
  ▼ [도구 핸들러 실행]
  └─ 마일스톤 계획 생성, 구조화된 텍스트 반환
  │
  ▼ [Post-Hook: src/mcp/hooks/post.ts]
  ├─ completeMilestone("plan_task"), resetRetry()
  └─ 응답에 "다음 단계: search_papers" 메타데이터 첨부
```

---

## 3. Claude Desktop 주도 워크플로우

```
사용자: "AI 윤리 발표 12장 만들어줘"
    │
    ▼
Claude Desktop AI (자율 판단)
    │
    ├─ [0] plan_task 호출 (목표 등록)
    │       goal="AI 윤리 발표 12장"
    │       [Post-Hook] → "다음 단계: search_papers"
    │
    ├─ [1] search_papers 호출
    │       topic="AI 윤리", keywords=["AI ethics", "알고리즘 편향"]
    │       [Post-Hook] → "다음 단계: register_references"
    │
    ├─ [2] 결과 검토 (AI 자신이)
    │       → 관련 논문 8편 선별
    │
    ├─ [3] register_references 호출
    │       → ref_001 ~ ref_008 등록
    │       [Post-Hook] → "다음 단계: save_output (콘텐츠 직접 작성 후)"
    │
    ├─ [4] Marp 마크다운 직접 작성 (AI 자신이)
    │       12장 구성: 표지→목차→현황→편향성→투명성→결론
    │
    ├─ [5] save_output 호출
    │       output_type='ppt', title='AI 윤리 기말발표'
    │       [Post-Hook] → state.status = 'done', "목표 완료"
    │       → ~/Desktop/AI_윤리_기말발표_2026-03-08.pdf
    │
    └─ [6] 사용자에게 결과 보고
```

### 첨부파일이 있는 경우

```
사용자: "이 강의자료 바탕으로 보고서 써줘" + lecture.pdf 첨부
    │
Claude Desktop AI
    ├─ plan_task("강의자료 기반 보고서", output_type='report')
    ├─ parse_file("/.../lecture.pdf")
    │       [Pre-Hook] 절대 경로 검증
    │       → 텍스트 + 메타데이터 수신
    ├─ search_papers (강의 주제 기반)
    ├─ register_references
    ├─ 보고서 마크다운 직접 작성
    └─ save_output(output_type='report')
```

---

## 4. 도구 호출 순서 예시

### 일반 PPT 생성

```
plan_task → search_papers → register_references → [Marp 작성] → save_output(ppt)
```

### 보고서 작성 (첨부파일 있음)

```
plan_task → parse_file → search_papers → register_references → [보고서 작성] → save_output(report)
```

### 자료조사만

```
search_papers → (결과를 Claude Desktop에서 직접 정리)
```

### 레퍼런스 확인

```
list_references → (조회 결과 대화로 보고)
```

---

## 5. 자율 복구 루프 (Autopilot)

**파일**: `src/mcp/hooks/post.ts`, `src/mcp/recovery.ts`

도구 실행 중 에러가 발생하면 Post-Hook이 자동으로 처리한다.

```
도구 실행 실패 (isError: true)
  │
  ▼ Post-Hook
  ├─ failMilestone(toolName)
  ├─ incrementRetry()
  ├─ addError(message)
  │
  ├─ retryCount < 3 → 에러 숨김, 복구 신호 주입
  │     응답 예시:
  │     "[복구 신호] 다음 에러가 발생했습니다: 검색 API 실패
  │      계획을 수정하고 다시 시도하세요. (시도 1/3)"
  │     → Claude AI가 자발적으로 재시도
  │
  └─ retryCount >= 3 → 사용자에게 에러 노출
        "❌ 3회 시도 후 실패: {error}"
```

### 성공 시 메타데이터 주입

```
도구 실행 성공
  │
  ▼ Post-Hook
  ├─ completeMilestone(toolName)
  ├─ resetRetry()
  └─ 응답 끝에 메타데이터 첨부:
       "---
        [시스템] 현재 목표: "AI 윤리 발표 12장" | 다음 단계: register_references"
```

---

## 6. State Manager 영속화

**파일**: `src/mcp/state.ts`
**저장 경로**: `~/.uni-agent/state.json`

서버 시작 시 이전 목표를 자동으로 불러온다 (세션 간 상태 유지).

```json
{
  "goal": "AI 윤리 발표 12장",
  "status": "in_progress",
  "startedAt": "2026-03-08T10:00:00Z",
  "milestones": [
    { "name": "plan_task", "status": "done", "completedAt": "..." },
    { "name": "search_papers", "status": "done", "completedAt": "..." },
    { "name": "register_references", "status": "pending" }
  ],
  "retryCount": 0,
  "errors": []
}
```

### 서버 시작 흐름

```
main()
  ├─ contextInjector.init()   ← CLAUDE.md·README.md 로드
  ├─ stateManager.load()      ← state.json 로드 (없으면 기본값)
  └─ server.connect(transport)
```

### 검색 API 일부 실패

`searchAll()`은 `Promise.allSettled()`로 3개 API를 병렬 실행한다.
하나 이상 실패해도 나머지 결과를 반환하고 Post-Hook에서 자율 복구를 시도한다.

### save_output 변환 실패

- Marp 실패 → 마크다운 파일 저장 후 경로 반환 (isError 없음 → Post-Hook이 완료 처리)
- Pandoc 미설치 → 마크다운 파일 저장 후 경로 반환

### parse_file 파싱 실패

- HWP 파서 로드 실패 → 빈 텍스트 반환 후 계속 진행 (graceful fallback)
- 지원 불가 형식 → isError: true → Post-Hook 복구 신호 주입
