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
export declare function editDistance(a: string, b: string): number;
/**
 * The candidate closest to `input`, or null when none is close enough to be a
 * plausible typo. Comparing case-insensitively keeps `nvarchar` from suggesting
 * something unrelated just because of capitalisation.
 */
export declare function suggest(input: string, candidates: readonly string[]): string | null;
//# sourceMappingURL=suggest.d.ts.map