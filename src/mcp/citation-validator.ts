/**
 * save_output 전 인용키 유효성 검사.
 * 마크다운 내 (authorYear) 패턴을 추출하고 등록된 citationKey Set과 대조한다.
 *
 * 패턴: (한글/영문 1자 이상 + 1950~2049 연도 + 소문자 suffix 선택)
 * 예시: (vaswani2017), (김2023), (lecun1998a)
 */
const CITATION_PATTERN = /\(([a-zA-Z\uAC00-\uD7A3]+(?:19[5-9]\d|20[0-4]\d)[a-z]?)\)/g;

export interface CitationValidationResult {
  valid: boolean;
  unregistered: string[];
}

export function validateCitationKeys(
  content: string,
  registeredKeys: Set<string>,
): CitationValidationResult {
  const cited = [...content.matchAll(CITATION_PATTERN)].map((m) => m[1] as string);
  const unregistered = cited.filter((key) => !registeredKeys.has(key));
  return { valid: unregistered.length === 0, unregistered };
}
