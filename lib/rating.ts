export function trimmedMean(values: number[], trimRatio = 0.1): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (nums.length === 0) return null;

  if (nums.length < 5) {
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return Math.round(avg * 100) / 100;
  }

  const trim = Math.floor(nums.length * trimRatio);
  const trimmed = nums.slice(trim, nums.length - trim);

  const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  return Math.round(avg * 100) / 100;
}