# 워크플로우 (Workflow)

> Thin MCP 패턴 기준. Claude Desktop AI가 직접 도구를 순서대로 호출하며
> 전체 과정을 처리한다. MCP 서버는 도구 실행만 담당한다.

---

## 목차

1. [MCP 도구 인터페이스](#1-mcp-도구-인터페이스)
2. [Claude Desktop 주도 워크플로우](#2-claude-desktop-주도-워크플로우)
3. [도구 호출 순서 예시](#3-도구-호출-순서-예시)
4. [실패 처리](#4-실패-처리)

---

## 1. MCP 도구 인터페이스

**파일**: `src/mcp/server.ts`

Claude Desktop에 노출되는 도구는 **5개**다.

| 도구 | 역할 |
|------|------|
| `search_papers` | 학술 논문 검색 (SS + OpenAlex + CrossRef 병렬) |
| `register_references` | 선택한 논문을 레퍼런스 DB에 등록 |
| `save_output` | 작성한 마크다운을 PDF/DOCX/MD로 저장 |
| `list_references` | 저장된 레퍼런스 라이브러리 조회 |
| `parse_file` | 첨부파일(PDF/PPTX/DOCX/HWP)에서 텍스트 추출 |

### search_papers 스펙

```typescript
// 입력
{
  topic: string;
  keywords?: string[];
  limit?: number;   // 기본 15
}
// 출력: PaperResult[] JSON
// → Claude Desktop AI가 결과를 직접 읽고 관련도 판단
```

### register_references 스펙

```typescript
// 입력
{
  papers: Array<{ title, authors, year, abstract?, doi?, url?, source }>;
}
// 출력: "ref_001: lecun2015 — Deep Learning" 줄 목록
// → 반환된 ref_id / citationKey를 마크다운 인용에 활용
```

### save_output 스펙

```typescript
// 입력
{
  content: string;            // Claude AI가 직접 작성한 마크다운
  output_type: 'ppt' | 'report' | 'notes';
  title: string;
  format?: 'pdf' | 'docx' | 'md';
}
// 출력: "저장 완료: ~/Desktop/제목_날짜.pdf (42KB, pdf)"
```

### parse_file 스펙

```typescript
// 입력
{ file_path: string }
// 출력: { text: string (최대 10000자), metadata: {...} } JSON
// → Claude AI가 내용을 직접 읽고 파악
```

---

## 2. Claude Desktop 주도 워크플로우

```
사용자: "AI 윤리 발표 12장 만들어줘"
    │
    ▼
Claude Desktop AI (자율 판단)
    │
    ├─ [1] 의도 파악: outputType = 'ppt', slideCount = 12
    │
    ├─ [2] search_papers 호출
    │       topic="AI 윤리", keywords=["AI ethics", "알고리즘 편향"]
    │       → PaperResult[] 반환
    │
    ├─ [3] 결과 검토 (AI 자신이)
    │       → 관련 논문 8편 선별, 관련성 이유 파악
    │
    ├─ [4] register_references 호출
    │       → ref_001 ~ ref_008 등록
    │       → citationKey 목록 수신
    │
    ├─ [5] Marp 마크다운 직접 작성 (AI 자신이)
    │       12장 구성: 표지→목차→현황→편향성→투명성→책임→사례→결론
    │       각 슬라이드에 (김철수, 2023) 형식 인용 삽입
    │
    ├─ [6] save_output 호출
    │       output_type='ppt', title='AI 윤리 기말발표'
    │       → ~/Desktop/AI_윤리_기말발표_2026-03-05.pdf
    │
    └─ [7] 사용자에게 결과 보고
```

### 첨부파일이 있는 경우

```
사용자: "이 강의자료 바탕으로 보고서 써줘" + lecture.pdf 첨부
    │
    ▼
Claude Desktop AI
    │
    ├─ [1] parse_file("/.../lecture.pdf") 호출
    │       → 텍스트 + 메타데이터 수신
    │
    ├─ [2] 내용 파악 후 핵심 주제 추출 (AI 자신이)
    │
    ├─ [3] search_papers 호출 (강의 주제 기반 키워드)
    │
    ├─ [4] register_references 호출
    │       (첨부파일도 필요시 별도 등록 가능)
    │
    ├─ [5] 보고서 마크다운 직접 작성
    │
    └─ [6] save_output(output_type='report') 호출
```

---

## 3. 도구 호출 순서 예시

### 일반 PPT 생성

```
search_papers → register_references → save_output(ppt)
```

### 보고서 작성 (첨부파일 있음)

```
parse_file → search_papers → register_references → save_output(report)
```

### 자료조사만

```
search_papers → (결과를 Claude Desktop에서 직접 정리해 대화로 전달)
```

### 레퍼런스 확인

```
list_references → (조회 결과 대화로 보고)
```

---

## 4. 실패 처리

### 검색 API 일부 실패

`searchAll()`은 `Promise.allSettled()`로 3개 API를 병렬 실행한다.
하나 이상 실패해도 나머지 결과를 반환하므로 Claude AI가 부분 결과로 계속 진행 가능하다.

### save_output 변환 실패

- Marp 실패 → 마크다운 파일로 자동 저장 후 경로 반환
- Pandoc 미설치 → 마크다운 파일로 자동 저장 후 경로 반환

### parse_file 파싱 실패

- HWP 파서 로드 실패 → 빈 텍스트 반환 후 진행 (graceful fallback)
- 지원 불가 형식 → 오류 메시지 반환

### 전체 오류 반환

```typescript
// 도구 실행 중 예외 발생 시
{
  content: [{ type: 'text', text: '❌ 내부 오류: {message}' }],
  isError: true,
}
```
