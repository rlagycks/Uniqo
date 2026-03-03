import { describe, it, expect } from 'vitest';
import {
  generateCitationKey,
  formatInlineCitation,
  formatApaEntry,
  formatBibliography,
} from './citation.js';
import type { ReferenceEntry } from '../types/index.js';

function makeEntry(overrides: Partial<ReferenceEntry> = {}): ReferenceEntry {
  return {
    id: 'ref_001',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'],
    year: 2017,
    doi: '10.48550/arXiv.1706.03762',
    source: 'semantic_scholar',
    chunkIds: [],
    usedIn: [],
    citationKey: 'vaswani2017',
    addedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('generateCitationKey', () => {
  it('영문 저자에서 성+연도 형식으로 키 생성', () => {
    const existing = new Set<string>();
    const key = generateCitationKey(['Ashish Vaswani'], 2017, existing);
    expect(key).toBe('vaswani2017');
  });

  it('한국어 저자에서 성+연도 형식으로 키 생성', () => {
    const existing = new Set<string>();
    const key = generateCitationKey(['김철수'], 2023, existing);
    expect(key).toBe('김2023');
  });

  it('중복 키에는 a, b를 붙인다', () => {
    const existing = new Set<string>(['vaswani2017']);
    const key = generateCitationKey(['Vaswani'], 2017, existing);
    expect(key).toBe('vaswani2017a');
  });

  it('두 번째 중복은 b를 붙인다', () => {
    const existing = new Set<string>(['vaswani2017', 'vaswani2017a']);
    const key = generateCitationKey(['Vaswani'], 2017, existing);
    expect(key).toBe('vaswani2017b');
  });

  it('생성된 키를 existing Set에 추가한다', () => {
    const existing = new Set<string>();
    generateCitationKey(['Smith'], 2020, existing);
    expect(existing.has('smith2020')).toBe(true);
  });
});

describe('formatInlineCitation', () => {
  it('저자 1명: (Last, Year)', () => {
    const entry = makeEntry({ authors: ['Vaswani, Ashish'], year: 2017 });
    expect(formatInlineCitation(entry)).toBe('(Vaswani, 2017)');
  });

  it('저자 2명: (Last & Last2, Year)', () => {
    const entry = makeEntry({ authors: ['Tom Brown', 'John Smith'], year: 2020 });
    const citation = formatInlineCitation(entry);
    expect(citation).toContain('2020');
    expect(citation).toContain('&');
  });

  it('저자 3명 이상: (Last et al., Year)', () => {
    const entry = makeEntry({
      authors: ['Tom Brown', 'John Smith', 'Jane Doe'],
      year: 2020,
    });
    expect(formatInlineCitation(entry)).toContain('et al.');
    expect(formatInlineCitation(entry)).toContain('2020');
  });

  it('저자 없음: (Unknown, Year)', () => {
    const entry = makeEntry({ authors: [], year: 2021 });
    expect(formatInlineCitation(entry)).toBe('(Unknown, 2021)');
  });
});

describe('formatApaEntry', () => {
  it('기본 APA 형식 생성', () => {
    const entry = makeEntry();
    const apa = formatApaEntry(entry);
    expect(apa).toContain('Vaswani');
    expect(apa).toContain('2017');
    expect(apa).toContain('Attention Is All You Need');
  });

  it('DOI가 있으면 포함', () => {
    const entry = makeEntry({ doi: '10.1234/test' });
    const apa = formatApaEntry(entry);
    expect(apa).toContain('doi.org/10.1234/test');
  });

  it('URL이 있으면 포함', () => {
    const entry = makeEntry({ doi: undefined, url: 'https://example.com/paper' });
    const apa = formatApaEntry(entry);
    expect(apa).toContain('https://example.com/paper');
  });
});

describe('formatBibliography', () => {
  it('참고문헌 헤더를 포함한다', () => {
    const entries = [makeEntry()];
    const biblio = formatBibliography(entries);
    expect(biblio).toContain('## 참고문헌');
  });

  it('여러 항목을 알파벳 순으로 정렬한다', () => {
    const entries = [
      makeEntry({ id: 'ref_002', authors: ['Zara Zhang'], year: 2022, title: 'Z Paper', citationKey: 'zhang2022' }),
      makeEntry({ id: 'ref_001', authors: ['Alice Brown'], year: 2021, title: 'A Paper', citationKey: 'brown2021' }),
    ];
    const biblio = formatBibliography(entries);
    // APA 형식으로 변환 시 성(last name) 기준: Brown → Zhang 순서
    const brownPos = biblio.indexOf('Brown');
    const zhangPos = biblio.indexOf('Zhang');
    expect(brownPos).toBeGreaterThan(-1);
    expect(zhangPos).toBeGreaterThan(-1);
    expect(brownPos).toBeLessThan(zhangPos);
  });

  it('빈 배열이면 헤더만 반환', () => {
    const biblio = formatBibliography([]);
    expect(biblio).toContain('## 참고문헌');
    expect(biblio.split('\n').filter(l => l.trim()).length).toBeLessThanOrEqual(2);
  });
});
