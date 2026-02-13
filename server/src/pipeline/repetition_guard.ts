const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "with",
  "you",
  "your"
]);

type Vector = Map<string, number>;

export type PriorFingerprint = {
  runId: string;
  fingerprint: string;
};

export type SimilarityMatch = {
  runId: string;
  fingerprint: string;
  score: number;
};

export function buildStoryFingerprint(logline: string, setting: string, cast: string[], stakes: string): string {
  return [logline, setting, cast.join(", "), stakes].map((s) => s.trim()).filter((s) => s.length > 0).join(" | ");
}

function tokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function vectorize(input: string): Vector {
  const v = new Map<string, number>();
  for (const t of tokens(input)) {
    v.set(t, (v.get(t) ?? 0) + 1);
  }
  return v;
}

export function cosineSimilarity(a: string, b: string): number {
  const va = vectorize(a);
  const vb = vectorize(b);
  if (va.size === 0 || vb.size === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const [, n] of va) {
    magA += n * n;
  }
  for (const [, n] of vb) {
    magB += n * n;
  }
  for (const [k, an] of va) {
    const bn = vb.get(k);
    if (bn) dot += an * bn;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return dot / denom;
}

export function closestFingerprint(target: string, prior: PriorFingerprint[]): SimilarityMatch | null {
  let best: SimilarityMatch | null = null;
  for (const p of prior) {
    const score = cosineSimilarity(target, p.fingerprint);
    if (!best || score > best.score) {
      best = { runId: p.runId, fingerprint: p.fingerprint, score };
    }
  }
  return best;
}
