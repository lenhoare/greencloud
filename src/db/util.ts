/** Tiny helpers for working with D1. Kept deliberately thin: plain SQL is the API. */

export const now = () => Date.now();
export const newId = () => crypto.randomUUID();

export const toIso = (ms: number) => new Date(ms).toISOString();
export const toIsoOrNull = (ms: number | null | undefined) => (ms == null ? null : toIso(ms));

/** Clamp pagination input to sane bounds. */
export function page(limit: number | undefined, offset: number | undefined, max = 100) {
  return {
    limit: Math.min(Math.max(limit ?? 50, 1), max),
    offset: Math.max(offset ?? 0, 0),
  };
}

/** Escape a user-supplied string for use inside a LIKE pattern (with ESCAPE '\'). */
export const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
