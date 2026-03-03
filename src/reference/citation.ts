import type { CitationRef, ReferenceEntry } from '../types/index.js';

/**
 * APA 스타일 인용 및 참고문헌 생성기
 */

/**
 * citationKey 생성: {성소문자}{연도}
 * 예: vaswani2017, 김철수2023
 * 중복 시 뒤에 a, b, c 붙임
 */
export function generateCitationKey(authors: string[], year: number, existing: Set<string>): string {
  const firstAuthor = authors[0] ?? 'unknown';
  // 성(last name) 추출: 영문은 마지막 단어, 한국어는 성(첫 글자 혹은 두 글자)
  const lastName = extractLastName(firstAuthor);
  const base = `${lastName.toLowerCase()}${year}`;

  if (!existing.has(base)) {
    existing.add(base);
    return base;
  }

  // 중복 처리: a, b, c, ...
  for (let i = 0; i < 26; i++) {
    const key = `${base}${String.fromCharCode(97 + i)}`;
    if (!existing.has(key)) {
      existing.add(key);
      return key;
    }
  }

  return `${base}_${Date.now()}`;
}

function extractLastName(author: string): string {
  const trimmed = author.trim();
  // 한국어 이름 (1-2자 성)
  if (/[\u4e00-\u9fff\uac00-\ud7af]/.test(trimmed)) {
    return trimmed.slice(0, 1);
  }
  // 영문: "First Last" → "Last", "Last, First" → "Last"
  if (trimmed.includes(',')) {
    return trimmed.split(',')[0]?.trim() ?? trimmed;
  }
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] ?? trimmed;
}

/**
 * APA 인라인 인용: (Author, Year) 또는 (Author et al., Year)
 */
export function formatInlineCitation(entry: ReferenceEntry): string {
  const { authors, year } = entry;
  if (authors.length === 0) return `(Unknown, ${year})`;
  const lastName = extractLastName(authors[0] ?? '');

  if (authors.length === 1) return `(${lastName}, ${year})`;
  if (authors.length === 2) {
    const last2 = extractLastName(authors[1] ?? '');
    return `(${lastName} & ${last2}, ${year})`;
  }
  return `(${lastName} et al., ${year})`;
}

/**
 * APA 참고문헌 항목 형식
 * 예: Vaswani, A., Shazeer, N., et al. (2017). Attention is all you need. ...
 */
export function formatApaEntry(entry: ReferenceEntry): string {
  const authorStr = formatAuthorsApa(entry.authors);
  const year = entry.year ?? 'n.d.';
  const title = entry.title;
  const doi = entry.doi ? ` https://doi.org/${entry.doi}` : '';
  const url = !entry.doi && entry.url ? ` ${entry.url}` : '';

  switch (entry.source) {
    case 'semantic_scholar':
    case 'riss':
      return `${authorStr} (${year}). ${title}.${doi}${url}`;
    case 'pdf':
    case 'docx':
      return `${authorStr} (${year}). ${title}.`;
    case 'url':
      return `${authorStr} (${year}). ${title}. Retrieved from${url}`;
    default:
      return `${authorStr} (${year}). ${title}.${doi}${url}`;
  }
}

function formatAuthorsApa(authors: string[]): string {
  if (authors.length === 0) return 'Unknown';
  if (authors.length === 1) return formatAuthorApa(authors[0] ?? '');
  if (authors.length <= 7) {
    const all = authors.map(formatAuthorApa);
    const last = all.pop();
    return `${all.join(', ')}, & ${last}`;
  }
  // 7명 초과: 처음 6명 + ... + 마지막 1명
  const first6 = authors.slice(0, 6).map(formatAuthorApa);
  const last = formatAuthorApa(authors[authors.length - 1] ?? '');
  return `${first6.join(', ')}, ... ${last}`;
}

function formatAuthorApa(author: string): string {
  const trimmed = author.trim();
  // 이미 "Last, First" 형식
  if (trimmed.includes(',')) return trimmed;

  // 한국어 이름
  if (/[\uac00-\ud7af]/.test(trimmed)) return trimmed;

  // 영문 "First Last" → "Last, F."
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;
  const last = parts[parts.length - 1] ?? '';
  const initials = parts
    .slice(0, -1)
    .map((p) => `${p[0] ?? ''}.`)
    .join(' ');
  return `${last}, ${initials}`;
}

/**
 * 참고문헌 목록 전체 텍스트 생성
 */
export function formatBibliography(entries: ReferenceEntry[]): string {
  const sorted = [...entries].sort((a, b) => {
    const aName = extractLastName(a.authors[0] ?? '');
    const bName = extractLastName(b.authors[0] ?? '');
    return aName.localeCompare(bName);
  });

  const lines = sorted.map((e) => formatApaEntry(e));
  return '## 참고문헌\n\n' + lines.join('\n\n');
}

/**
 * 사용된 refId 목록에서 CitationRef 배열 생성
 */
export function buildCitationRefs(
  entries: ReferenceEntry[],
  usedRefIds: Array<{ refId: string; context: string; sectionTitle: string }>,
): CitationRef[] {
  const entryMap = new Map(entries.map((e) => [e.id, e]));

  return usedRefIds
    .map(({ refId, context, sectionTitle }) => {
      const entry = entryMap.get(refId);
      if (!entry) return null;
      return {
        refId,
        citationKey: entry.citationKey,
        formattedCitation: formatInlineCitation(entry),
        context,
        sectionTitle,
      } satisfies CitationRef;
    })
    .filter((c): c is CitationRef => c !== null);
}
