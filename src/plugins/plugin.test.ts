import { describe, it, expect, vi } from 'vitest';
import { PluginRegistry } from './plugin.js';
import type { PluginAgent, PluginInput, PluginResult } from './plugin.js';

function makePlugin(overrides?: Partial<PluginAgent>): PluginAgent {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    description: '테스트 플러그인',
    supportedExtensions: ['xyz'],
    execute: vi.fn().mockResolvedValue({ success: true, text: '파싱된 내용' }),
    ...overrides,
  };
}

describe('PluginRegistry', () => {
  it('플러그인 등록 및 get 동작', () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin();
    registry.register(plugin);
    expect(registry.get('test-plugin')).toBe(plugin);
  });

  it('등록되지 않은 플러그인 execute → success:false 반환', async () => {
    const registry = new PluginRegistry();
    const result = await registry.execute('nonexistent', { filePath: '/tmp/file.xyz' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('nonexistent');
  });

  it('supportedExtensions로 findByExtension 조회', () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin({ supportedExtensions: ['abc', 'def'] });
    registry.register(plugin);
    expect(registry.findByExtension('abc')).toBe(plugin);
    expect(registry.findByExtension('.def')).toBe(plugin);  // 점 prefix 제거 확인
    expect(registry.findByExtension('ghi')).toBeUndefined();
  });

  it('unregister 후 get → undefined', () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin();
    registry.register(plugin);
    const removed = registry.unregister('test-plugin');
    expect(removed).toBe(true);
    expect(registry.get('test-plugin')).toBeUndefined();
  });

  it('execute 중 예외 발생 → success:false + error 반환', async () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin({
      execute: vi.fn().mockRejectedValue(new Error('파싱 오류')),
    });
    registry.register(plugin);
    const result = await registry.execute('test-plugin', { filePath: '/tmp/file.xyz' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('파싱 오류');
  });

  it('validate() 실패 시 execute → success:false', async () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin({
      validate: (_input: PluginInput) => false,
    });
    registry.register(plugin);
    const result = await registry.execute('test-plugin', { filePath: '/tmp/file.xyz' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid input');
  });
});
