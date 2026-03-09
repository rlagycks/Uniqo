import { describe, it, expect } from 'vitest';
import { getPersona, isAllowed } from './role-router.js';

describe('role-router', () => {
  describe('getPersona', () => {
    it('plan_task → architect', () => {
      expect(getPersona('plan_task')).toBe('architect');
    });

    it('search_papers → researcher', () => {
      expect(getPersona('search_papers')).toBe('researcher');
    });

    it('register_references → researcher', () => {
      expect(getPersona('register_references')).toBe('researcher');
    });

    it('save_output → worker', () => {
      expect(getPersona('save_output')).toBe('worker');
    });

    it('list_references → reader', () => {
      expect(getPersona('list_references')).toBe('reader');
    });

    it('parse_file → reader', () => {
      expect(getPersona('parse_file')).toBe('reader');
    });

    it('알 수 없는 도구 → reader (기본값)', () => {
      expect(getPersona('unknown_tool')).toBe('reader');
    });
  });

  describe('isAllowed', () => {
    it('올바른 페르소나는 허용', () => {
      expect(isAllowed('search_papers', 'researcher')).toBe(true);
      expect(isAllowed('plan_task', 'architect')).toBe(true);
      expect(isAllowed('save_output', 'worker')).toBe(true);
      expect(isAllowed('parse_file', 'reader')).toBe(true);
    });

    it('잘못된 페르소나는 거부', () => {
      expect(isAllowed('search_papers', 'worker')).toBe(false);
      expect(isAllowed('save_output', 'researcher')).toBe(false);
      expect(isAllowed('plan_task', 'reader')).toBe(false);
    });
  });
});
