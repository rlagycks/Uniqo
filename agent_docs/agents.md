# 에이전트 명세 (Agents)

> Thin MCP 패턴 기준. Claude Desktop AI가 모든 판단과 콘텐츠 작성을 직접 담당하며,
> MCP 서버는 I/O 도구(검색, 파일 저장, 레퍼런스 관리)만 제공한다.

---

## 목차

1. [전체 협업 구조](#1-전체-협업-구조)
2. [MCP 도구 명세](#2-mcp-도구-명세)
3. [search.ts — 검색 함수](#3-searchts--검색-함수)
4. [Formatter Agent](#4-formatter-agent)
5. [Claude Desktop의 역할](#5-claude-desktop의-역할)

---

## 1. 전체 협업 구조

```
Claude Desktop (AI 자신이 판단·작성)
  │
  ├── search_papers       ← 논문 검색 (MCP 서버가 실행)
  ├── register_references ← 선택한 논문 DB 등록 (MCP 서버가 실행)
  ├── parse_file          ← 첨부파일 텍스트 추출 (MCP 서버가 실행)
  ├── save_output         ← 작성한 내용 파일로 변환 (FormatterAgent 호출)
  └── list_references     ← 레퍼런스 목록 조회 (MCP 서버가 실행)
```

**핵심 원칙**: MCP 서버는 LLM을 호출하지 않는다. Claude Desktop AI가 직접 판단하고 도구를 순서대로 호출하며 전체 과정을 처리한다.

### 이전 방식 vs 현재 방식

```
이전 (Fat MCP — 실패):
  Claude Desktop → run_task(intent) → MCP서버 내부에서 LLM 호출 → 실패
  이유: Claude Desktop이 MCP Sampling(-32601 Method not found)을 지원하지 않음

현재 (Thin MCP):
  Claude Desktop → search_papers → 결과 검토 (AI 자신이)
                → register_references → Marp 마크다운 직접 작성
                → save_output → PDF/DOCX 생성
```

---

## 2. MCP 도구 명세

**파일**: `src/mcp/server.ts`

Claude Desktop에 노출되는 도구는 **5개**다.

### 도구 1: `search_papers`

```typescript
// 입력
{
  topic: string;              // 검색 주제
  keywords?: string[];        // 검색 키워드 (없으면 topic 사용)
  limit?: number;             // 최대 결과 수 (기본 15)
}
// 출력: PaperResult[] JSON 문자열
```

- Semantic Scholar / OpenAlex / CrossRef 3-way 병렬 검색
- 제목 기반 중복 제거 후 `limit`개 반환
- Claude Desktop AI가 반환된 결과를 직접 읽고 관련도를 판단한다

### 도구 2: `register_references`

```typescript
// 입력
{
  papers: Array<{
    title: string;
    authors: string[];
    year: number;
    abstract?: string;
    doi?: string;
    url?: string;
    source: string;
  }>;
}
// 출력: "ref_001: lecun2015 — Deep Learning" 형식 줄 목록
```

- `search_papers` 결과 중 관련성 높은 논문만 Claude Desktop AI가 선별해 등록
- 청킹 + 임베딩 + Vector Store 자동 저장
- 반환된 `ref_id`와 `citationKey`를 마크다운 인용에 활용

### 도구 3: `save_output`

```typescript
// 입력
{
  content: string;           // Marp/보고서 마크다운 전체 내용
  output_type: 'ppt' | 'report' | 'notes';
  title: string;             // 파일 제목
  format?: 'pdf' | 'docx' | 'md';
}
// 출력: "저장 완료: ~/Desktop/제목_날짜.pdf (42KB, pdf)"
```

- Claude Desktop AI가 직접 작성한 마크다운을 파일로 변환
- `FormatterAgent`를 호출해 Marp→PDF, Pandoc→DOCX, MD 저장
- 변환 실패 시 마크다운 파일로 자동 fallback

### 도구 4: `list_references`

```typescript
// 입력
{
  source?: 'semantic_scholar' | 'openalex' | 'crossref' | 'pdf' | 'pptx' | 'docx' | 'url' | 'doi' | 'image';
  year?: number;
}
// 출력: "📚 참고문헌 목록 (N건)\n\n1. [ref_001] ..."
```

- 등록된 레퍼런스 목록 조회
- 출처 / 연도 필터 지원

### 도구 5: `parse_file`

```typescript
// 입력
{
  file_path: string;         // 파싱할 파일의 절대 경로
}
// 출력: { text: string (최대 10000자), metadata: {...} } JSON
```

- PDF / PPTX / DOCX / HWP / HWPX / 이미지 파싱
- Claude Desktop AI가 텍스트를 직접 읽고 내용을 파악해 활용

---

## 3. search.ts — 검색 함수

**파일**: `src/tools/search.ts`

`search_papers` 도구가 내부적으로 호출하는 순수 함수들.

### 공개 타입

```typescript
interface PaperResult {
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  doi?: string;
  source: 'semantic_scholar' | 'openalex' | 'crossref';
  url?: string;
}
```

### 공개 함수

```typescript
// 3개 API 병렬 검색 + 중복 제거 + limit 적용
export async function searchAll(keywords: string[], _topic: string, limit: number): Promise<PaperResult[]>

// Semantic Scholar (영문 키워드 우선)
export async function searchSemanticScholar(keywords: string[], limit?: number): Promise<PaperResult[]>

// OpenAlex (한국어 포함 전체 언어, 무료)
export async function searchOpenAlex(keywords: string[], limit?: number): Promise<PaperResult[]>

// CrossRef (DOI 기반, 글로벌, 무료)
export async function searchCrossRef(keywords: string[], limit?: number): Promise<PaperResult[]>

// 제목 기반 중복 제거 (앞 50자 대조)
export function deduplicatePapers(papers: PaperResult[]): PaperResult[]
```

### 외부 API

모든 검색 API는 인증 키 없이 사용 가능하다.

| API | 용도 | 비용 | 인증 |
|-----|------|------|------|
| Semantic Scholar | 글로벌 논문 2억+ 검색 | 무료 | 불필요 |
| OpenAlex | 글로벌 + 한국어 논문 필터 | 무료 | 불필요 (mailto 권장) |
| CrossRef | DOI 기반 학술 메타데이터 | 무료 | 불필요 (mailto 권장) |

---

## 4. Formatter Agent

**파일**: `src/agents/formatter.ts`

유일하게 남은 내부 에이전트. `save_output` 도구가 호출한다.

### 역할

- Claude Desktop AI가 작성한 마크다운 → 최종 파일 변환
- Marp CLI → PDF (PPT)
- Pandoc → DOCX (보고서)
- 마크다운 저장 (노트, 리서치)
- 등록된 레퍼런스의 APA 참고문헌 페이지 자동 삽입

### 입출력

```typescript
interface FormatterInput {
  draft: Draft;              // content 필드에 마크다운 전체 내용
  outputType: OutputType;   // 'ppt' | 'report' | 'notes' | 'research_only'
  outputDir?: string;        // 기본값: ~/Desktop
  templateName?: string;    // templates/ 내 템플릿
}

interface FormatterOutput {
  outputPath: string;        // 생성된 파일의 절대 경로
  format: 'pdf' | 'docx' | 'md';
  sizeBytes: number;
}
```

### 변환 파이프라인

```
PPT 요청 (outputType: 'ppt'):
  Marp Markdown → @marp-team/marp-cli → PDF
  실패 시 → 마크다운 파일로 fallback

보고서 요청 (outputType: 'report'):
  Pandoc 설치 확인 → Pandoc Markdown → Pandoc CLI → DOCX
  Pandoc 없으면 → 마크다운 파일로 fallback

노트/리서치 (outputType: 'notes' | 'research_only'):
  Markdown → 파일 저장 (변환 없음)
```

### 한국 대학 템플릿 (`templates/`)

| 템플릿 | 용도 |
|--------|------|
| `academic-ppt` | 학부 발표 기본 |
| `team-project` | 팀 프로젝트 발표 |
| `seminar` | 세미나·특강 |
| `minimal` | 미니멀 스타일 |
| `report-standard` | 보고서 기본 양식 |

---

## 5. MCP Prompts (슬래시 명령)

**파일**: `src/mcp/server.ts`

Claude Desktop에서 `/` 입력 시 드롭다운에 나타나는 프롬프트 명령 5개.
각 명령은 Claude Desktop AI에게 도구 호출 순서와 목표를 지시하는 메시지를 전달한다.

| 명령 | 인자 | 동작 |
|------|------|------|
| `/ppt` | `topic` | search_papers → register_references → Marp 12슬라이드 작성 → save_output(ppt) |
| `/report` | `topic` | search_papers → register_references → 보고서 작성 → save_output(report) |
| `/search` | `topic` | search_papers → 결과 요약 |
| `/notes` | `topic` | 파일 경로면 parse_file, 아니면 search_papers → save_output(notes) |
| `/refs` | 없음 | list_references → 전체 목록 출력 |

---

## 6. Claude Desktop의 역할

Thin MCP 패턴에서 Claude Desktop AI가 직접 수행하는 작업:

| 작업 | 설명 |
|------|------|
| 의도 파악 | 사용자 요청 분석, 출력 유형 결정 |
| 검색어 생성 | 주제에서 한국어/영문 키워드 도출 |
| 관련성 판단 | `search_papers` 결과 검토, 관련 논문 선별 |
| 키포인트 추출 | 선별한 논문의 핵심 논점 파악 |
| 문서 구조 설계 | outputType에 따른 섹션 구성 결정 |
| 콘텐츠 작성 | Marp/보고서 마크다운 직접 작성 |
| 참고문헌 인용 | `register_references`로 받은 citationKey로 인용 삽입 |
| 파일 저장 지시 | `save_output` 호출로 최종 파일 생성 |
