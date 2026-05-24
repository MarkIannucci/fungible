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

/**
 * Validates a regex pattern and throws if it is syntactically invalid or causes
 * catastrophic backtracking (ReDoS). Call this before persisting user-supplied patterns.
 */
export function validateRegex(pattern: string): void {
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }
  // Detect ReDoS by timing the regex against a worst-case input.
  const probe = 'a'.repeat(64) + '\x00';
  const start = Date.now();
  re.test(probe);
  if (Date.now() - start > 100) {
    throw new Error(`Regex pattern causes excessive backtracking and cannot be used: ${pattern}`);
  }
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
