/** Returns true if the transaction amount is within the rule's optional range. */
export function inAmountRange(
  amount: number | undefined,
  min: number | null,
  max: number | null,
): boolean {
  if (amount === undefined) return true;
  if (min !== null && amount < min) return false;
  if (max !== null && amount > max) return false;
  return true;
}

/** Returns true if any haystack string matches the pattern. */
export function matchesPattern(
  pattern: string,
  matchType: 'name' | 'regex',
  haystacks: string[],
): boolean {
  if (matchType === 'name') {
    const lower = pattern.toLowerCase();
    return haystacks.some((h) => h.includes(lower));
  }
  const re = new RegExp(pattern, 'i');
  return haystacks.some((h) => re.test(h));
}
