# 컨텍스트 관리 (Context)

> 청킹 전략, Vector Store 설계, 임베딩, 세션 간 상태 유지를 정의한다.

---

## 목차

1. [문서 청킹 전략](#1-문서-청킹-전략)
2. [Vector Store 설계](#2-vector-store-설계)
3. [임베딩 모델](#3-임베딩-모델)
4. [세션 간 컨텍스트 유지](#4-세션-간-컨텍스트-유지)

---

## 1. 문서 청킹 전략

**파일**: `src/context/chunker.ts`

### 청킹 규칙

| 문서 유형 | 청킹 방식 | 청크 크기 | 오버랩 |
|-----------|-----------|-----------|--------|
| 학술 논문 Abstract | 단일 청크 (분할 금지) | 전체 | 없음 |
| 학술 논문 본문 | 단락 기준 | 512 토큰 | 50 토큰 |
| 강의 PPT | 슬라이드 1장 = 청크 1개 | 슬라이드 단위 | 없음 |
| 보고서 | 섹션 제목 기준 | 섹션 단위 | 없음 |
| 보고서 초과 섹션 | 단락 기준 세분화 | 512 토큰 | 50 토큰 |

### Abstract 분할 금지 이유

Abstract는 논문 전체의 압축 요약이므로 분할하면 의미가 손상된다.

### 청크 메타데이터 구조

```typescript
interface Chunk {
  id: string;               // chunk_{refId}_{index}
  refId: string;            // 원본 레퍼런스 ID
  text: string;             // 청크 텍스트
  embedding: number[];      // 벡터 임베딩 (768차원)
  metadata: ChunkMetadata;
}

interface ChunkMetadata {
  chunkIndex: number;
  totalChunks: number;
  section?: string;         // 논문 섹션명 (Abstract, Introduction 등)
  slideIndex?: number;      // PPT 슬라이드 번호
  pageNumber?: number;      // 페이지 번호
  isAbstract?: boolean;     // Abstract 여부
}
```

---

## 2. Vector Store 설계

**파일**: `src/context/vector-store.ts`
**라이브러리**: `hnswlib-node` (로컬, 서버 불필요) + 브루트포스 fallback

### 저장 경로

```
~/.uni-agent/
└── vector-store/
    ├── index.bin          ← HNSW 인덱스 바이너리
    ├── metadata.json      ← 청크 메타데이터 매핑
    └── embeddings.json    ← 청크별 임베딩 벡터
```

### 주요 연산

```typescript
// 청크 추가 (임베딩 포함)
await vectorStore.add(chunk: Chunk): Promise<void>

// 유사도 검색 (벡터 입력, 코사인 유사도)
await vectorStore.search(queryEmbedding: number[], topK: number): Promise<SearchResult[]>
// SearchResult: { chunk: Chunk; distance: number }

// 레퍼런스 삭제 (특정 논문의 모든 청크 제거)
await vectorStore.deleteByRefId(refId: string): Promise<void>
```

### 차원 불일치 처리

VectorStore 초기화 시 저장된 임베딩 차원과 현재 차원이 다르면 인덱스를 자동으로 초기화한다.
기존 `~/.uni-agent/vector-store/` 인덱스가 768차원 이외로 저장된 경우 자동 클리어된다.

---

## 3. 임베딩 모델

**파일**: `src/context/manager.ts`
**라이브러리**: `@xenova/transformers`

| 항목 | 값 |
|------|-----|
| 모델 | `multilingual-e5-base` |
| 차원 | 768 (고정) |
| 언어 | 한국어 포함 100개 이상 언어 지원 |
| 첫 실행 | ~280MB 모델 다운로드 (이후 캐시) |
| 실패 시 | TF-IDF 기반 fallback (768차원 유지) |

### 임베딩 캐시

동일 텍스트의 임베딩은 `~/.uni-agent/embedding-cache.json`에 영구 저장된다.
재실행 시 캐시에서 바로 반환하므로 모델 추론 생략 가능.

---

## 4. 세션 간 컨텍스트 유지

**파일**: `src/context/manager.ts`
**저장 경로**: `~/.uni-agent/sessions/{sessionId}.json`

### 세션 상태 구조

```typescript
interface SessionState {
  sessionId: string;
  userProfile: UserProfile;
  referenceLibrary: string[];   // 사용된 레퍼런스 ID 목록
  taskHistory: TaskHistoryEntry[];
  createdAt: string;
  updatedAt: string;            // 마지막 수정 시각 (자동 갱신)
}

interface UserProfile {
  preferredLanguage: 'ko' | 'en' | 'mixed'; // 선호 언어 (기본: 'ko')
  university?: string;          // 예: "한양대"
  major?: string;               // 예: "컴퓨터공학"
}

interface TaskHistoryEntry {
  taskId: string;               // 작업 고유 ID
  intent: string;               // 사용자 요청 원문
  outputPath?: string;          // 생성된 파일 경로
  completedAt: string;          // 완료 시각
  status: 'done' | 'error';     // 완료 상태
}
```

### 세션 재개 흐름

```
다음 세션 시작
  └── sessionId 확인 (없으면 신규 생성)
        └── 기존 SessionState 로드
              ├── 사용자 프로필 자동 적용
              └── 레퍼런스 라이브러리 복원
```

### 세션 만료

- 세션 파일은 자동 만료하지 않는다 (사용자가 명시적으로 정리)
- 레퍼런스 라이브러리는 세션과 무관하게 영구 저장
- 임베딩 캐시: `~/.uni-agent/embedding-cache.json` (영구)
