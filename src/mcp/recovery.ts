export const MAX_RETRIES = 3;

export function buildRecoverySignal(
  error: string,
  retryCount: number,
  maxRetries: number,
): string {
  return (
    `\n\n---\n[복구 신호] 다음 에러가 발생했습니다: ${error}\n` +
    `계획을 수정하고 다시 시도하세요. (시도 ${retryCount}/${maxRetries})`
  );
}

export function isMaxRetries(count: number, max = MAX_RETRIES): boolean {
  return count >= max;
}
