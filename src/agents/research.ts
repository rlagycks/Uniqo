import type { LLMCaller } from '../mcp/sampling.js';
import type {
  ResearchInput,
  ResearchReport,
  PaperSummary,
  SemanticScholarPaper,
  SemanticScholarResponse,
  OpenAlexWork,
  OpenAlexResponse,
  CrossRefWork,
  CrossRefResponse,
  OutputType,
} from '../types/index.js';
import { referenceStore } from '../reference/store.js';

const SEMANTIC_SCHOLAR_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const OPENALEX_URL = 'https://api.openalex.org/works';
const CROSSREF_URL = 'https://api.crossref.org/works';
const MAX_ITERATIONS = 3;
const MIN_CONFIDENCE = 0.6;
const MIN_PAPERS = 3;

type AnyPaper = SemanticScholarPaper | OpenAlexWork | CrossRefWork;

export class ResearchAgent {
  constructor(private llm: LLMCaller) {}

  async run(input: ResearchInput): Promise<ResearchReport> {
    let iteration = 0;
    let refinementHint = input.refinementHint;

    let lastTop: Array<{ paper: AnyPaper; score: number }> = [];
    let lastKeywords: string[] = [];
    let lastTotalFound = 0;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      // 1. 검색어 생성
      const keywords = await this.generateKeywords(input.topic, input.outputType, refinementHint);
      lastKeywords = keywords;

      // 2. 병렬 검색 (3-way)
      const [ssResults, openAlexResults, crossRefResults] = await Promise.allSettled([
        this.searchSemanticScholar(keywords),
        this.searchOpenAlex(keywords),
        this.searchCrossRef(keywords),
      ]);

      const rawPapers: AnyPaper[] = [
        ...(ssResults.status === 'fulfilled' ? ssResults.value : []),
        ...(openAlexResults.status === 'fulfilled' ? openAlexResults.value : []),
        ...(crossRefResults.status === 'fulfilled' ? crossRefResults.value : []),
      ];
      lastTotalFound = rawPapers.length;

      // 3. 관련성 채점
      const scored = await this.scorePapers(rawPapers, input.topic);

      // 4. 중복 제거 + 상위 선별
      const unique = this.deduplicatePapers(scored);
      lastTop = unique.slice(0, 10);

      // 5. 갭 분석
      const gaps = await this.analyzeGaps(lastTop.map((s) => s.paper), input.topic);

      // 6. 신뢰도 계산
      const confidence = this.calculateConfidence(lastTop.map((s) => s.paper), gaps);

      // 7. 조기 종료 조건 충족 시 반환
      if (confidence >= MIN_CONFIDENCE && lastTop.length >= MIN_PAPERS) {
        const paperSummaries = await this.registerPapers(lastTop);

        return {
          papers: paperSummaries,
          confidence,
          gaps,
          searchKeywords: keywords,
          totalFound: rawPapers.length,
          iterationCount: iteration,
        };
      }

      // 8. 재시도: 검색어 힌트 갱신
      refinementHint = gaps.length > 0
        ? `다음 갭을 보완하는 자료를 찾아주세요: ${gaps.join(', ')}`
        : `더 구체적인 키워드로 재검색해주세요. 현재 결과 수: ${lastTop.length}`;
    }

    // 마지막 반복 결과 재사용 — 추가 API 호출 없음
    const paperSummaries = await this.registerPapers(lastTop);

    return {
      papers: paperSummaries,
      confidence: this.calculateConfidence(lastTop.map((s) => s.paper), []),
      gaps: ['최대 반복 횟수 도달 - 자료가 제한적일 수 있습니다'],
      searchKeywords: lastKeywords,
      totalFound: lastTotalFound,
      iterationCount: MAX_ITERATIONS,
    };
  }

  private async generateKeywords(
    topic: string,
    outputType: OutputType,
    hint?: string,
  ): Promise<string[]> {
    const prompt = `
당신은 학술 검색 전문가입니다. 다음 주제에 대해 Semantic Scholar와 OpenAlex 검색에 최적화된 키워드를 생성해주세요.

주제: ${topic}
출력 유형: ${outputType}
${hint ? `보완 힌트: ${hint}` : ''}

다음 형식으로 정확히 응답하세요 (JSON 배열):
["영문 키워드1", "영문 키워드2", "한국어 키워드1", "한국어 키워드2"]

최대 6개, 가장 관련성 높은 순으로 정렬.
`.trim();

    const text = await this.llm(prompt, 256);
    try {
      const match = text.match(/\[[\s\S]*\]/);
      return match ? JSON.parse(match[0]) as string[] : [topic];
    } catch {
      return [topic];
    }
  }

  private async searchSemanticScholar(keywords: string[]): Promise<SemanticScholarPaper[]> {
    const query = keywords.filter(this.isEnglish).slice(0, 2).join(' ');
    if (!query) return [];

    const url = `${SEMANTIC_SCHOLAR_URL}?query=${encodeURIComponent(query)}&fields=title,authors,year,abstract,externalIds,citationCount&limit=20`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'uni-agent/2.0.0' },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) return [];
      const data = await res.json() as SemanticScholarResponse;
      return data.data ?? [];
    } catch {
      return [];
    }
  }

  private async searchOpenAlex(keywords: string[]): Promise<OpenAlexWork[]> {
    const query = keywords.slice(0, 3).join(' ');
    if (!query) return [];

    const url = `${OPENALEX_URL}?search=${encodeURIComponent(query)}&per-page=20&mailto=uni-agent@example.com`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'uni-agent/2.0.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return [];
      const data = await res.json() as OpenAlexResponse;
      return data.results ?? [];
    } catch {
      return [];
    }
  }

  private async searchCrossRef(keywords: string[]): Promise<CrossRefWork[]> {
    const query = keywords.filter(this.isEnglish).slice(0, 2).join(' ');
    if (!query) return [];

    const url = `${CROSSREF_URL}?query=${encodeURIComponent(query)}&rows=20&sort=relevance`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'uni-agent/2.0.0 (mailto:uni-agent@example.com)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return [];
      const data = await res.json() as CrossRefResponse;
      return data.message?.items ?? [];
    } catch {
      return [];
    }
  }

  private async scorePapers(
    papers: AnyPaper[],
    topic: string,
  ): Promise<Array<{ paper: AnyPaper; score: number }>> {
    if (papers.length === 0) return [];

    const scored: Array<{ paper: AnyPaper; score: number }> = [];

    for (let i = 0; i < papers.length; i += 5) {
      const batch = papers.slice(i, i + 5);
      const batchScores = await this.scoreBatch(batch, topic);
      for (let j = 0; j < batch.length; j++) {
        scored.push({ paper: batch[j]!, score: batchScores[j] ?? 0 });
      }
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  private async scoreBatch(
    batch: AnyPaper[],
    topic: string,
  ): Promise<number[]> {
    const abstracts = batch.map((p, i) => {
      const title = this.getPaperTitle(p);
      const abstract = this.getPaperAbstract(p);
      return `[${i + 1}] 제목: ${title}\n초록: ${abstract.slice(0, 300)}`;
    });

    const prompt = `
주제: "${topic}"

다음 논문들의 관련성을 0.0~1.0으로 채점하세요.

${abstracts.join('\n\n')}

정확히 ${batch.length}개의 점수를 JSON 배열로 반환: [0.8, 0.3, ...]
`.trim();

    try {
      const text = await this.llm(prompt, 128);
      const match = text.match(/\[[\d.,\s]+\]/);
      if (match) {
        const scores = JSON.parse(match[0]) as number[];
        return scores.slice(0, batch.length);
      }
    } catch {
      // 채점 실패 시 기본 점수
    }

    return batch.map(() => 0.5);
  }

  private deduplicatePapers(
    papers: Array<{ paper: AnyPaper; score: number }>,
  ): Array<{ paper: AnyPaper; score: number }> {
    const seen = new Set<string>();
    return papers.filter((s) => {
      const key = this.getPaperTitle(s.paper).toLowerCase().trim().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async analyzeGaps(papers: AnyPaper[], _topic: string): Promise<string[]> {
    if (papers.length === 0) return ['관련 논문을 찾을 수 없습니다'];

    const years = papers.map((p) => this.getPaperYear(p));
    const avgYear = years.reduce((s, y) => s + y, 0) / years.length;
    const currentYear = new Date().getFullYear();

    const gaps: string[] = [];
    if (avgYear < currentYear - 5) gaps.push('최근 5년 내 연구 부족');
    if (papers.every((p) => !('paperId' in p))) gaps.push('영문 국제 논문 부족');
    if (papers.every((p) => 'paperId' in p)) gaps.push('국내/다양한 출처 연구 부족');

    return gaps;
  }

  private calculateConfidence(papers: AnyPaper[], gaps: string[]): number {
    let score = Math.min(papers.length / 10, 1.0);
    score -= gaps.length * 0.1;
    return Math.max(0, Math.min(1, score));
  }

  private async registerPapers(
    scoredPapers: Array<{ paper: AnyPaper; score: number }>,
  ): Promise<PaperSummary[]> {
    if (scoredPapers.length === 0) return [];

    const keyPointsPerPaper = await this.extractKeyPointsBatch(
      scoredPapers.map((s) => ({
        title: this.getPaperTitle(s.paper),
        abstract: this.getPaperAbstract(s.paper),
      })),
    );

    const summaries: PaperSummary[] = [];

    for (let i = 0; i < scoredPapers.length; i++) {
      const item = scoredPapers[i]!;
      try {
        const entry = await referenceStore.addFromApiResult(item.paper);

        summaries.push({
          refId: entry.id,
          title: entry.title,
          authors: entry.authors,
          year: entry.year,
          relevanceScore: item.score,
          keyPoints: keyPointsPerPaper[i] ?? [],
          source: this.detectPaperSource(item.paper),
          doi: entry.doi,
          abstract: this.getPaperAbstract(item.paper),
        });
      } catch {
        // 등록 실패한 논문 스킵
      }
    }

    return summaries;
  }

  private getPaperTitle(p: AnyPaper): string {
    if ('title' in p && Array.isArray(p.title)) return p.title[0] ?? '';
    return p.title as string;
  }

  private getPaperAbstract(p: AnyPaper): string {
    if ('paperId' in p) return (p as SemanticScholarPaper).abstract ?? '';
    if ('authorships' in p) {
      const oa = p as OpenAlexWork;
      if (oa.abstract_inverted_index) {
        return this.reconstructAbstract(oa.abstract_inverted_index);
      }
      return '';
    }
    return (p as CrossRefWork).abstract ?? '';
  }

  private reconstructAbstract(invertedIndex: Record<string, number[]>): string {
    const positions: Array<[number, string]> = [];
    for (const [word, idxs] of Object.entries(invertedIndex)) {
      for (const idx of idxs) {
        positions.push([idx, word]);
      }
    }
    return positions.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join(' ');
  }

  private getPaperYear(p: AnyPaper): number {
    if ('paperId' in p) return (p as SemanticScholarPaper).year ?? 0;
    if ('authorships' in p) return (p as OpenAlexWork).publication_year ?? 0;
    const cr = p as CrossRefWork;
    return cr['published-print']?.['date-parts']?.[0]?.[0] ?? 0;
  }

  private detectPaperSource(p: AnyPaper): PaperSummary['source'] {
    if ('paperId' in p) return 'semantic_scholar';
    if ('authorships' in p) return 'openalex';
    return 'crossref';
  }

  /**
   * 논문 배열에서 LLM을 이용해 keyPoints를 배치 추출한다.
   * 3개씩 묶어 API 호출을 최소화하고, 파싱 실패 시 abstract 자르기로 fallback.
   */
  private async extractKeyPointsBatch(
    papers: Array<{ title: string; abstract?: string }>,
  ): Promise<string[][]> {
    const BATCH_SIZE = 3;
    const results: string[][] = new Array(papers.length).fill(null).map(() => []);

    for (let i = 0; i < papers.length; i += BATCH_SIZE) {
      const batch = papers.slice(i, i + BATCH_SIZE);
      const batchResults = await this.extractKeyPointsForBatch(batch);

      for (let j = 0; j < batch.length; j++) {
        results[i + j] = batchResults[j] ?? this.fallbackKeyPoints(batch[j]!);
      }
    }

    return results;
  }

  private async extractKeyPointsForBatch(
    batch: Array<{ title: string; abstract?: string }>,
  ): Promise<string[][]> {
    const isKoreanBatch = batch.some((p) => this.isKorean(p.title));
    const langInstruction = isKoreanBatch ? '한국어로' : 'in English';

    const papersText = batch
      .map((p, idx) => `[${idx + 1}] ${p.title}\n${(p.abstract ?? '').slice(0, 400)}`)
      .join('\n\n');

    const prompt = `
다음 ${batch.length}편의 논문에서 각각 핵심 논점 3개를 ${langInstruction} 추출하세요.

${papersText}

JSON 형식으로 응답: [["논점1","논점2","논점3"],["논점1","논점2","논점3"],...]
논문 수와 동일한 ${batch.length}개의 배열을 반환하세요.
`.trim();

    try {
      const text = await this.llm(prompt, 512);
      const match = text.match(/\[\s*\[[\s\S]*\]\s*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]) as string[][];
        if (Array.isArray(parsed) && parsed.length === batch.length) {
          return parsed;
        }
      }
    } catch {
      // LLM 실패 시 fallback
    }

    return batch.map((p) => this.fallbackKeyPoints(p));
  }

  private fallbackKeyPoints(paper: { abstract?: string }): string[] {
    const text = paper.abstract ?? '';
    if (!text) return [];
    return [text.slice(0, 200)];
  }

  private isEnglish(text: string): boolean {
    return /^[a-zA-Z\s]+$/.test(text);
  }

  private isKorean(text: string): boolean {
    return /[\uac00-\ud7af]/.test(text);
  }
}
