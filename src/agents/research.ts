import Anthropic from '@anthropic-ai/sdk';
import type {
  ResearchInput,
  ResearchReport,
  PaperSummary,
  SemanticScholarPaper,
  SemanticScholarResponse,
  RissPaper,
  RissResponse,
  DbpiaPaper,
  DbpiaResponse,
  TavilyResult,
  TavilyResponse,
  OutputType,
} from '../types/index.js';
import { referenceStore } from '../reference/store.js';

const SEMANTIC_SCHOLAR_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const RISS_URL = 'https://openapi.riss.kr/api/v2/search';
const DBPIA_URL = 'https://api.dbpia.co.kr/v2/search/publication';
const TAVILY_URL = 'https://api.tavily.com/search';
const MAX_ITERATIONS = 3;
const MIN_CONFIDENCE = 0.6;
const MIN_PAPERS = 3;

type AnyPaper = SemanticScholarPaper | RissPaper | DbpiaPaper | TavilyResult;

export class ResearchAgent {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async run(input: ResearchInput): Promise<ResearchReport> {
    let iteration = 0;
    let refinementHint = input.refinementHint;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      // 1. 검색어 생성
      const keywords = await this.generateKeywords(input.topic, input.outputType, refinementHint);

      // 2. 병렬 검색
      const [ssResults, rissResults, dbpiaResults, tavilyResults] = await Promise.allSettled([
        this.searchSemanticScholar(keywords),
        this.searchRiss(keywords),
        this.searchDbpia(keywords),
        this.searchTavily(keywords),
      ]);

      const rawPapers: AnyPaper[] = [
        ...(ssResults.status === 'fulfilled' ? ssResults.value : []),
        ...(rissResults.status === 'fulfilled' ? rissResults.value : []),
        ...(dbpiaResults.status === 'fulfilled' ? dbpiaResults.value : []),
        ...(tavilyResults.status === 'fulfilled' ? tavilyResults.value : []),
      ];

      // 3. 관련성 채점
      const scored = await this.scorePapers(rawPapers as AnyPaper[], input.topic);

      // 4. 중복 제거 + 상위 선별
      const unique = this.deduplicatePapers(scored);
      const top = unique.slice(0, 10);

      // 5. 갭 분석
      const gaps = await this.analyzeGaps(top, input.topic);

      // 6. 신뢰도 계산
      const confidence = this.calculateConfidence(top, gaps);

      // 7. 조기 종료 조건 충족 시 반환
      if (confidence >= MIN_CONFIDENCE && top.length >= MIN_PAPERS) {
        // Reference Store 등록
        const paperSummaries = await this.registerPapers(top);

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
        : `더 구체적인 키워드로 재검색해주세요. 현재 결과 수: ${top.length}`;
    }

    // MAX_ITERATIONS 도달 시 현재까지 결과 반환
    const finalKeywords = await this.generateKeywords(input.topic, input.outputType, refinementHint);
    const [ssResults, , dbpiaFinal, tavilyFinal] = await Promise.allSettled([
      this.searchSemanticScholar(finalKeywords),
      this.searchRiss(finalKeywords),
      this.searchDbpia(finalKeywords),
      this.searchTavily(finalKeywords),
    ]);
    const rawPapers: AnyPaper[] = [
      ...(ssResults.status === 'fulfilled' ? ssResults.value : []),
      ...(dbpiaFinal.status === 'fulfilled' ? dbpiaFinal.value : []),
      ...(tavilyFinal.status === 'fulfilled' ? tavilyFinal.value : []),
    ];
    const scored = await this.scorePapers(rawPapers, input.topic);
    const top = this.deduplicatePapers(scored).slice(0, 10);
    const paperSummaries = await this.registerPapers(top);

    return {
      papers: paperSummaries,
      confidence: this.calculateConfidence(top, []),
      gaps: ['최대 반복 횟수 도달 - 자료가 제한적일 수 있습니다'],
      searchKeywords: finalKeywords,
      totalFound: rawPapers.length,
      iterationCount: MAX_ITERATIONS,
    };
  }

  private async generateKeywords(
    topic: string,
    outputType: OutputType,
    hint?: string,
  ): Promise<string[]> {
    const prompt = `
당신은 학술 검색 전문가입니다. 다음 주제에 대해 Semantic Scholar와 RISS 검색에 최적화된 키워드를 생성해주세요.

주제: ${topic}
출력 유형: ${outputType}
${hint ? `보완 힌트: ${hint}` : ''}

다음 형식으로 정확히 응답하세요 (JSON 배열):
["영문 키워드1", "영문 키워드2", "한국어 키워드1", "한국어 키워드2"]

최대 6개, 가장 관련성 높은 순으로 정렬.
`.trim();

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '[]';
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
        headers: { 'User-Agent': 'uni-agent/0.1.0' },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) return [];
      const data = await res.json() as SemanticScholarResponse;
      return data.data ?? [];
    } catch {
      return [];
    }
  }

  private async searchRiss(keywords: string[]): Promise<RissPaper[]> {
    const apiKey = process.env['RISS_API_KEY'];
    if (!apiKey) return [];

    const query = keywords.filter(this.isKorean).slice(0, 2).join(' ');
    if (!query) return [];

    const url = `${RISS_URL}?isQueryUseAnd=1&query=${encodeURIComponent(query)}&apiKey=${apiKey}&etype=d&sort=score&start=0&rows=20`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return [];
      const data = await res.json() as RissResponse;
      return data.result?.rows ?? [];
    } catch {
      return [];
    }
  }

  private async scorePapers(
    papers: AnyPaper[],
    topic: string,
  ): Promise<AnyPaper[]> {
    if (papers.length === 0) return [];

    // 배치 채점 (5개씩)
    const scored: Array<{ paper: AnyPaper; score: number }> = [];

    for (let i = 0; i < papers.length; i += 5) {
      const batch = papers.slice(i, i + 5);
      const batchScores = await this.scoreBatch(batch, topic);
      for (let j = 0; j < batch.length; j++) {
        scored.push({ paper: batch[j]!, score: batchScores[j] ?? 0 });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .map((s) => s.paper);
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
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 128,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '[]';
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

  private deduplicatePapers(papers: AnyPaper[]): AnyPaper[] {
    const seen = new Set<string>();
    return papers.filter((p) => {
      const key = this.getPaperTitle(p).toLowerCase().trim().slice(0, 50);
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
    if (papers.every((p) => 'paperId' in p)) gaps.push('국내 연구 부족');

    return gaps;
  }

  private calculateConfidence(papers: AnyPaper[], gaps: string[]): number {
    let score = Math.min(papers.length / 10, 1.0);
    score -= gaps.length * 0.1;
    return Math.max(0, Math.min(1, score));
  }

  private async registerPapers(papers: AnyPaper[]): Promise<PaperSummary[]> {
    if (papers.length === 0) return [];

    // 배치 keyPoint 추출
    const keyPointsPerPaper = await this.extractKeyPointsBatch(
      papers.map((p) => ({
        title: this.getPaperTitle(p),
        abstract: this.getPaperAbstract(p),
      })),
    );

    const summaries: PaperSummary[] = [];

    for (let i = 0; i < papers.length; i++) {
      const paper = papers[i]!;
      try {
        const entry = await referenceStore.addFromApiResult(paper);

        summaries.push({
          refId: entry.id,
          title: entry.title,
          authors: entry.authors,
          year: entry.year,
          relevanceScore: 0.7,
          keyPoints: keyPointsPerPaper[i] ?? [],
          source: this.detectPaperSource(paper),
          doi: entry.doi,
          abstract: this.getPaperAbstract(paper),
        });
      } catch {
        // 등록 실패한 논문 스킵
      }
    }

    return summaries;
  }

  private getPaperTitle(p: AnyPaper): string { return p.title; }

  private getPaperAbstract(p: AnyPaper): string {
    if ('paperId' in p) return p.abstract ?? '';
    if ('controlNo' in p) return (p as RissPaper).abstract ?? '';
    if ('publicationId' in p) return (p as DbpiaPaper).abstract ?? '';
    return (p as TavilyResult).content;
  }

  private getPaperYear(p: AnyPaper): number {
    if ('year' in p) return (p as SemanticScholarPaper).year;
    if ('pubtYear' in p) return parseInt((p as RissPaper).pubtYear, 10) || 0;
    if ('publishYear' in p) return parseInt((p as DbpiaPaper).publishYear, 10) || 0;
    const d = (p as TavilyResult).published_date;
    return d ? parseInt(d.slice(0, 4), 10) : 0;
  }

  private detectPaperSource(p: AnyPaper): PaperSummary['source'] {
    if ('paperId' in p) return 'semantic_scholar';
    if ('controlNo' in p) return 'riss';
    if ('publicationId' in p) return 'dbpia';
    return 'tavily';
  }

  private async searchDbpia(keywords: string[]): Promise<DbpiaPaper[]> {
    const apiKey = process.env['DBPIA_API_KEY'];
    if (!apiKey) return [];
    const query = keywords.slice(0, 2).join(' ');
    if (!query) return [];
    const url = `${DBPIA_URL}?query=${encodeURIComponent(query)}&apiKey=${apiKey}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return [];
      return ((await res.json() as DbpiaResponse).content) ?? [];
    } catch { return []; }
  }

  private async searchTavily(keywords: string[]): Promise<TavilyResult[]> {
    const apiKey = process.env['TAVILY_API_KEY'];
    if (!apiKey) return [];
    const query = keywords.slice(0, 2).join(' ');
    if (!query) return [];
    try {
      const res = await fetch(TAVILY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: 5 }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return [];
      return ((await res.json() as TavilyResponse).results) ?? [];
    } catch { return []; }
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
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '[]';
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

export const researchAgent = new ResearchAgent();
