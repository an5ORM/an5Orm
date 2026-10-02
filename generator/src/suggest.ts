/**
 * "Did you mean" for typos.
 *
 * Lives on its own because two callers need it and neither should own it:
 * the config loader (a mistyped option key) and the field type registry (a
 * type written for the wrong database). Both want the nearest candidate out
 * of a known list, or nothing at all when the input is not close enough that
 * a suggestion would be honest.
 */

/** Levenshtein distance between two strings. */
export function editDistance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push([i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
    }
  }
  return rows[a.length]![b.length]!;
}

/**
 * The candidate closest to `input`, or null when none is close enough to be a
 * plausible typo. Comparing case-insensitively keeps `nvarchar` from suggesting
 * something unrelated just because of capitalisation.
 */
export function suggest(input: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(input.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best !== null && bestDistance <= Math.max(2, Math.floor(input.length / 3)) ? best : null;
}