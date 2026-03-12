import { describe, it, expect } from 'vitest';
import { validateCitationKeys } from './citation-validator.js';

describe('validateCitationKeys', () => {
  it('등록된 인용키만 있으면 valid: true를 반환한다', () => {
    const content = '내용입니다 (vaswani2017) 그리고 (lecun1998) 참고.';
    const keys = new Set(['vaswani2017', 'lecun1998']);
    const result = validateCitationKeys(content, keys);
    expect(result.valid).toBe(true);
    expect(result.unregistered).toHaveLength(0);
  });

  it('미등록 인용키가 있으면 valid: false와 해당 키를 반환한다', () => {
    const content = '참고 (vaswani2017) 와 (unknown2024) 를 인용.';
    const keys = new Set(['vaswani2017']);
    const result = validateCitationKeys(content, keys);
    expect(result.valid).toBe(false);
    expect(result.unregistered).toContain('unknown2024');
    expect(result.unregistered).not.toContain('vaswani2017');
  });

  it('인용키가 없는 마크다운은 valid: true를 반환한다', () => {
    const content = '# 제목\n\n인용 없는 문단입니다.';
    const keys = new Set<string>();
    const result = validateCitationKeys(content, keys);
    expect(result.valid).toBe(true);
    expect(result.unregistered).toHaveLength(0);
  });

  it('빈 content는 valid: true를 반환한다', () => {
    const result = validateCitationKeys('', new Set(['vaswani2017']));
    expect(result.valid).toBe(true);
  });

  it('한국어 저자명 인용키를 인식한다', () => {
    const content = '연구 결과 (김2023) 와 (이2021a) 참고.';
    const keys = new Set(['김2023']);
    const result = validateCitationKeys(content, keys);
    expect(result.valid).toBe(false);
    expect(result.unregistered).toContain('이2021a');
  });

  it('연도 범위 밖 숫자는 인용키로 인식하지 않는다', () => {
    const content = '(2024) 연도만 있는 경우나 (text1800) 오래된 연도는 무시.';
    const keys = new Set<string>();
    const result = validateCitationKeys(content, keys);
    expect(result.valid).toBe(true);
    expect(result.unregistered).toHaveLength(0);
  });

  it('suffix 있는 인용키 (예: lecun1998a)를 올바르게 처리한다', () => {
    const content = '두 논문 (lecun1998a) 과 (lecun1998b) 참조.';
    const keys = new Set(['lecun1998a', 'lecun1998b']);
    const result = validateCitationKeys(content, keys);
    expect(result.valid).toBe(true);
  });

  it('여러 미등록 키를 모두 반환한다', () => {
    const content = '(a2020) (b2021) (c2022)';
    const keys = new Set<string>();
    const result = validateCitationKeys(content, keys);
    expect(result.valid).toBe(false);
    expect(result.unregistered).toHaveLength(3);
    expect(result.unregistered).toEqual(expect.arrayContaining(['a2020', 'b2021', 'c2022']));
  });
});
