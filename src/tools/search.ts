import type {
  PaperResult,
  SemanticScholarPaper,
  SemanticScholarResponse,
  OpenAlexWork,
  OpenAlexResponse,
  CrossRefWork,
  CrossRefResponse,
} from '../types/index.js';

const SEMANTIC_SCHOLAR_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const OPENALEX_URL = 'https://api.openalex.org/works';
const CROSSREF_URL = 'https://api.crossref.org/works';

export type { PaperResult };

/**
 * 3개 API를 병렬 검색 후 중복 제거하여 반환.
 * 개별 API 실패는 무시하고 나머지 결과를 반환.
 */
export async function searchAll(keywords: string[], topic: string, limit: number): Promise<PaperResult[]> {
  const [ssResults, openAlexResults, crossRefResults] = await Promise.allSettled([
    searchSemanticScholar(keywords),
    searchOpenAlex(keywords),
    searchCrossRef(keywords),
  ]);

  const papers: PaperResult[] = [
    ...(ssResults.status === 'fulfilled' ? ssResults.value : []),
    ...(openAlexResults.status === 'fulfilled' ? openAlexResults.value : []),
    ...(crossRefResults.status === 'fulfilled' ? crossRefResults.value : []),
  ];

  const deduped = deduplicatePapers(papers);
  const scored = scorePapers(deduped, topic);
  return scored.slice(0, limit);
}

export async function searchSemanticScholar(keywords: string[], limit = 20): Promise<PaperResult[]> {
  const query = keywords.filter(isEnglish).slice(0, 2).join(' ');
  if (!query) return [];

  const url = `${SEMANTIC_SCHOLAR_URL}?query=${encodeURIComponent(query)}&fields=title,authors,year,abstract,externalIds,citationCount&limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'uni-agent/2.0.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json() as SemanticScholarResponse;
    return (data.data ?? []).map(normalizeSS);
  } catch {
    return [];
  }
}

export async function searchOpenAlex(keywords: string[], limit = 20): Promise<PaperResult[]> {
  const query = keywords.slice(0, 3).join(' ');
  if (!query) return [];

  const url = `${OPENALEX_URL}?search=${encodeURIComponent(query)}&per-page=${limit}&mailto=uni-agent@example.com`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'uni-agent/2.0.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json() as OpenAlexResponse;
    return (data.results ?? []).map(normalizeOA);
  } catch {
    return [];
  }
}

export async function searchCrossRef(keywords: string[], limit = 20): Promise<PaperResult[]> {
  const query = keywords.filter(isEnglish).slice(0, 2).join(' ');
  if (!query) return [];

  const url = `${CROSSREF_URL}?query=${encodeURIComponent(query)}&rows=${limit}&sort=relevance`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'uni-agent/2.0.0 (mailto:uni-agent@example.com)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json() as CrossRefResponse;
    return (data.message?.items ?? []).map(normalizeCR);
  } catch {
    return [];
  }
}

export function deduplicatePapers(papers: PaperResult[]): PaperResult[] {
  const seen = new Set<string>();
  return papers.filter((p) => {
    const key = p.title.toLowerCase().trim().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 다차원 스코어링: recency×0.3 + citationNorm×0.5 + abstractMatch×0.2
 * citationCount가 없는 논문은 배열 내 중앙값을 기본값으로 사용 (불이익 방지).
 */
export function scorePapers(papers: PaperResult[], query: string): PaperResult[] {
  const currentYear = new Date().getFullYear();
  const queryTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);

  const withCitations = papers.filter((p) => p.citationCount !== undefined);
  const maxCitations =
    withCitations.length > 0 ? Math.max(...withCitations.map((p) => p.citationCount!)) : 0;

  const sortedCitations = withCitations.map((p) => p.citationCount!).sort((a, b) => a - b);
  const medianCitation =
    sortedCitations.length > 0 ? (sortedCitations[Math.floor(sortedCitations.length / 2)] ?? 0) : 0;

  return papers
    .map((paper) => {
      const recency = paper.year > 0 ? Math.max(0, 1 - (currentYear - paper.year) / 30) : 0;

      let citationNorm: number;
      if (paper.citationCount !== undefined) {
        citationNorm = maxCitations > 0 ? paper.citationCount / maxCitations : 0;
      } else {
        citationNorm = maxCitations > 0 ? medianCitation / maxCitations : 0.5;
      }

      const textToSearch = (paper.abstract ?? paper.title).toLowerCase();
      const matchCount = queryTokens.filter((t) => textToSearch.includes(t)).length;
      const abstractMatch = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;

      const score = recency * 0.3 + citationNorm * 0.5 + abstractMatch * 0.2;
      return { ...paper, score };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// ─── Private normalization helpers ───────────────────────────────

function normalizeSS(p: SemanticScholarPaper): PaperResult {
  return {
    title: p.title,
    authors: p.authors.map((a) => a.name),
    year: p.year ?? 0,
    abstract: p.abstract,
    doi: p.externalIds?.DOI,
    source: 'semantic_scholar',
    citationCount: p.citationCount,
  };
}

function normalizeOA(p: OpenAlexWork): PaperResult {
  const abstract = p.abstract_inverted_index
    ? reconstructAbstract(p.abstract_inverted_index)
    : undefined;
  const doi = p.doi?.replace('https://doi.org/', '');
  return {
    title: p.title,
    authors: p.authorships.map((a) => a.author.display_name),
    year: p.publication_year ?? 0,
    abstract,
    doi,
    source: 'openalex',
    url: p.doi ?? p.id,
  };
}

function normalizeCR(p: CrossRefWork): PaperResult {
  const title = Array.isArray(p.title) ? (p.title[0] ?? '') : (p.title as string);
  const authors = (p.author ?? []).map((a) => `${a.given ?? ''} ${a.family ?? ''}`.trim());
  const year = p['published-print']?.['date-parts']?.[0]?.[0] ?? 0;
  return {
    title,
    authors,
    year,
    abstract: p.abstract,
    doi: p.DOI,
    source: 'crossref',
    url: `https://doi.org/${p.DOI}`,
  };
}

function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  const positions: Array<[number, string]> = [];
  for (const [word, idxs] of Object.entries(invertedIndex)) {
    for (const idx of idxs) {
      positions.push([idx, word]);
    }
  }
  return positions.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join(' ');
}

function isEnglish(text: string): boolean {
  return /^[a-zA-Z\s]+$/.test(text);
}
