import { describe, it, expect } from 'vitest';
import { buildRecoverySignal, isMaxRetries, MAX_RETRIES } from './recovery.js';

describe('recovery', () => {
  describe('buildRecoverySignal', () => {
    it('에러 메시지와 시도 횟수를 포함한 복구 신호 생성', () => {
      const signal = buildRecoverySignal('검색 API 실패', 1, 3);
      expect(signal).toContain('검색 API 실패');
      expect(signal).toContain('1/3');
      expect(signal).toContain('[복구 신호]');
    });

    it('구분자(---) 포함', () => {
      const signal = buildRecoverySignal('오류', 2, 3);
      expect(signal).toContain('---');
    });

    it('시도 횟수가 max_retries에 가까울 때 표시', () => {
      const signal = buildRecoverySignal('오류', 2, 3);
      expect(signal).toContain('2/3');
    });
  });

  describe('isMaxRetries', () => {
    it('count === max 이면 true', () => {
      expect(isMaxRetries(3, 3)).toBe(true);
    });

    it('count > max 이면 true', () => {
      expect(isMaxRetries(4, 3)).toBe(true);
    });

    it('count < max 이면 false', () => {
      expect(isMaxRetries(2, 3)).toBe(false);
    });

    it('기본값 MAX_RETRIES 사용', () => {
      expect(isMaxRetries(MAX_RETRIES)).toBe(true);
      expect(isMaxRetries(MAX_RETRIES - 1)).toBe(false);
    });
  });

  describe('MAX_RETRIES', () => {
    it('3으로 설정', () => {
      expect(MAX_RETRIES).toBe(3);
    });
  });
});
