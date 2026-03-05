# 참고자료 관리 (Reference)

> 파일 파싱, 레퍼런스 저장 구조, 인용 추적을 정의한다.

---

## 목차

1. [3가지 입력 방식](#1-3가지-입력-방식)
2. [파일 형식별 파싱 방법](#2-파일-형식별-파싱-방법)
3. [레퍼런스 저장 구조](#3-레퍼런스-저장-구조)
4. [인용 추적 (Citation Graph)](#4-인용-추적-citation-graph)
5. [Reference Store API](#5-reference-store-api)
6. [레퍼런스 라이브러리 조회 (list_references)](#6-레퍼런스-라이브러리-조회-list_references)

---

## 1. 3가지 입력 방식

### 방식 1: 파일 직접 첨부

Claude Desktop 대화창에 파일 경로를 제공하고 `parse_file` 도구로 파싱.

```
사용자: "이거 바탕으로 보고서 써줘" + /path/to/lecture.pdf 경로 제공
          ↓
parse_file("/path/to/lecture.pdf") 호출
          ↓
텍스트 + 메타데이터 추출 → Claude AI가 직접 내용 파악
          ↓
search_papers로 관련 논문 검색 → register_references → 보고서 작성
```

### 방식 2: 학술 검색 결과 등록

`search_papers` → Claude AI가 관련 논문 선별 → `register_references` 호출.

```
search_papers(topic="AI 윤리") → PaperResult[] 반환
  ↓ Claude AI가 관련성 판단
register_references([{ title, authors, year, ... }]) 호출
  ↓
ref_001 ~ ref_008 등록 + citationKey 수신
```

### 방식 3: URL 또는 DOI 제공

```typescript
// reference/store.ts — add() 메서드
await referenceStore.add({ type: 'doi', doi: '10.48550/arXiv.1706.03762' });
await referenceStore.add({ type: 'url', url: 'https://arxiv.org/abs/...' });
```

---

## 2. 파일 형식별 파싱 방법

**파일**: `src/reference/parser.ts`

| 파일 형식 | 파싱 라이브러리 | 추출 내용 |
|-----------|----------------|-----------|
| PDF | `pdf-parse` | 텍스트 전문 + 메타데이터 (제목, 저자, 페이지) |
| PPTX | `pptx2json` | 슬라이드별 텍스트 + 발표자 노트 |
| DOCX | `mammoth` | HTML 경유 텍스트 (서식 보존) |
| HWP / HWPX | `hwp.js` (동적 import) | 텍스트 추출, 실패 시 graceful fallback |
| 이미지 PNG/JPG | Claude Desktop이 직접 처리 | 파일 경로를 대화에서 언급하면 AI가 Vision으로 분석 |

> **HWP 지원**: `hwp.js`를 동적 import하며, 로드 실패 시 빈 텍스트를 반환하고 정상 진행한다.
> `pptx2json`은 타입 선언이 없으므로 `as any`로 처리된다.

> **참고**: `pdf-parse`는 ESM/CJS 이중 export 이슈로 동적 import 후 `.default` fallback을 사용한다.

---

## 3. 레퍼런스 저장 구조

**파일**: `src/reference/store.ts`
**저장 경로**: `~/.uni-agent/references/`

### 디렉토리 구조

```
~/.uni-agent/
└── references/
    ├── index.json         ← 전체 레퍼런스 메타데이터 인덱스
    ├── chunks/            ← Vector DB에 저장된 청크 파일들 (Vector Store가 관리)
    └── originals/         ← 원본 파일 복사본
        └── ref_001_attention.pdf
```

### ReferenceSource 타입

```typescript
type ReferenceSource =
  | 'pdf'              // PDF 파일 직접 첨부
  | 'pptx'             // PPTX 파일 직접 첨부
  | 'docx'             // DOCX 파일 직접 첨부
  | 'image'            // 이미지 파일 직접 첨부
  | 'url'              // URL 또는 일반 웹 링크
  | 'doi'              // DOI 링크
  | 'semantic_scholar' // Semantic Scholar API 검색 결과
  | 'openalex'         // OpenAlex API 검색 결과
  | 'crossref';        // CrossRef API 검색 결과
```

### 레퍼런스 인덱스 스키마 (`index.json`)

```typescript
interface ReferenceEntry {
  id: string;                   // "ref_001" 형식 (자동 채번)
  title: string;
  authors: string[];            // ["Vaswani et al."]
  year: number;
  doi?: string;                 // "10.48550/arXiv.1706.03762"
  url?: string;
  source: ReferenceSource;
  chunkIds: string[];           // Vector DB에 저장된 청크 ID 목록
  usedIn: string[];             // 사용된 섹션/파일 경로 기록
  citationKey: string;          // "vaswani2017" (인용 시 사용)
  addedAt: string;              // ISO 날짜
  filePath?: string;            // 원본 파일 경로 (로컬 파일인 경우)
}
```

### 레퍼런스 인덱스 예시

```json
{
  "id": "ref_001",
  "title": "Attention Is All You Need",
  "authors": ["Vaswani et al."],
  "year": 2017,
  "doi": "10.48550/arXiv.1706.03762",
  "source": "semantic_scholar",
  "chunkIds": ["chunk_ref_001_0", "chunk_ref_001_1"],
  "usedIn": [],
  "citationKey": "vaswani2017",
  "addedAt": "2026-03-05T10:30:00Z"
}
```

---

## 4. 인용 추적 (Citation Graph)

**파일**: `src/reference/citation.ts`

모든 레퍼런스는 **어디에 사용됐는지** 추적된다.

### APA 인용 형식

```
단독 저자: (Vaswani, 2017)
두 저자:   (Vaswani & Shazeer, 2017)
다수 저자: (Vaswani et al., 2017)
```

### citationKey 생성 규칙

```
vaswani2017    ← 영문 성(last name) + 연도
김2023         ← 한국어 성(첫 글자) + 연도
vaswani2017a   ← 동일 키 중복 시 a, b, c... 추가
```

### 최종 결과물 참고문헌 자동 삽입

Claude AI가 `save_output` 호출 시 `citations` 배열이 있으면 Formatter Agent가 자동 삽입한다.

```
PPT: 마지막 슬라이드 (--- 구분자 이후)
보고서: 문서 말미 (## 참고문헌)
```

---

## 5. Reference Store API

**파일**: `src/reference/store.ts`

```typescript
class ReferenceStore {
  // 파일/URL/DOI로 새 레퍼런스 등록 (파싱 + 청킹 + Vector Store 저장)
  async add(input: ReferenceInput): Promise<ReferenceEntry>

  // 검색 API 결과(raw) 직접 등록 (Semantic Scholar / OpenAlex / CrossRef)
  async addFromApiResult(
    paper: SemanticScholarPaper | OpenAlexWork | CrossRefWork | { title: string; url?: string; content?: string }
  ): Promise<ReferenceEntry>

  // 정규화된 PaperResult 등록 (register_references 도구가 사용)
  async addPaperResult(paper: PaperResult): Promise<ReferenceEntry>

  // ID로 레퍼런스 조회
  get(refId: string): ReferenceEntry | null

  // 전체 레퍼런스 목록 조회
  list(filter?: { source?: ReferenceSource; year?: number }): ReferenceEntry[]

  // 레퍼런스 삭제 (Vector DB 청크도 함께 삭제)
  delete(refId: string): boolean

  // 사용 기록 업데이트
  markAsUsed(refId: string, location: string): void
}
```

### PaperResult 구조 (addPaperResult 입력)

```typescript
interface PaperResult {
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  doi?: string;
  url?: string;
  source: 'semantic_scholar' | 'openalex' | 'crossref';
}
```

### ReferenceInput 구조 (add 입력)

```typescript
interface ReferenceInput {
  type: 'file' | 'url' | 'doi' | 'api_result';
  filePath?: string;   // type === 'file'
  url?: string;        // type === 'url'
  doi?: string;        // type === 'doi'
  apiResult?: SemanticScholarPaper | OpenAlexWork | CrossRefWork;
}
```

---

## 6. 레퍼런스 라이브러리 조회 (list_references)

Claude Desktop에 노출되는 5개 도구 중 하나.

### 도구 스펙

```typescript
{
  source?: 'semantic_scholar' | 'openalex' | 'crossref' | 'pdf' | 'pptx' | 'docx' | 'url' | 'doi' | 'image';
  year?: number;   // 출판 연도 필터
}
```

### 응답 예시

```
📚 참고문헌 목록 (2건)

1. [ref_001] Attention Is All You Need — Vaswani et al. (2017) [semantic_scholar]
2. [ref_002] AI 윤리 가이드라인 연구 — 홍길동 (2023) [openalex]
```
