export type ReferenceMatch<T> =
  | { status: "MATCH"; record: T; matchedLabel: string; fuzzy: boolean }
  | { status: "AMBIGUOUS"; records: T[]; suggestions: string[] }
  | { status: "NONE"; suggestions: string[] };

type ReferenceCandidate<T> = {
  record: T;
  labels: string[];
};

export function normalizeEntityReference(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'"`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value: string): string {
  return normalizeEntityReference(value).replace(/\s+/g, "");
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0)
  );
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );

      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }

  return matrix[left.length][right.length];
}

function fuzzyThreshold(length: number): number {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  return 3;
}

export function matchEntityReference<T>(
  reference: string,
  candidates: ReferenceCandidate<T>[]
): ReferenceMatch<T> {
  const normalizedReference = normalizeEntityReference(reference);
  const compactReference = compact(reference);

  if (!normalizedReference || !compactReference) {
    return { status: "NONE", suggestions: [] };
  }

  const prepared = candidates.flatMap((candidate) =>
    candidate.labels
      .filter(Boolean)
      .map((label) => ({
        ...candidate,
        label,
        normalized: normalizeEntityReference(label),
        compact: compact(label),
      }))
  );

  const exact = prepared.filter(
    (candidate) =>
      candidate.normalized === normalizedReference ||
      candidate.compact === compactReference
  );

  const exactRecords = [...new Set(exact.map((candidate) => candidate.record))];

  if (exactRecords.length === 1) {
    const matched = exact.find(
      (candidate) => candidate.record === exactRecords[0]
    )!;
    return {
      status: "MATCH",
      record: exactRecords[0],
      matchedLabel: matched.label,
      fuzzy: false,
    };
  }

  if (exactRecords.length > 1) {
    return {
      status: "AMBIGUOUS",
      records: exactRecords,
      suggestions: [...new Set(exact.map((candidate) => candidate.label))].slice(
        0,
        5
      ),
    };
  }

  if (compactReference.length >= 3) {
    const partial = prepared.filter(
      (candidate) =>
        candidate.compact.includes(compactReference) ||
        compactReference.includes(candidate.compact)
    );
    const partialRecords = [
      ...new Set(partial.map((candidate) => candidate.record)),
    ];

    if (partialRecords.length === 1) {
      const matched = partial.find(
        (candidate) => candidate.record === partialRecords[0]
      )!;
      return {
        status: "MATCH",
        record: partialRecords[0],
        matchedLabel: matched.label,
        fuzzy: false,
      };
    }

    if (partialRecords.length > 1) {
      return {
        status: "AMBIGUOUS",
        records: partialRecords,
        suggestions: [
          ...new Set(partial.map((candidate) => candidate.label)),
        ].slice(0, 5),
      };
    }
  }

  const ranked = prepared
    .map((candidate) => ({
      ...candidate,
      distance: editDistance(compactReference, candidate.compact),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.compact.length - right.compact.length
    );

  const best = ranked[0];
  const threshold = fuzzyThreshold(compactReference.length);

  if (!best || best.distance > threshold) {
    return {
      status: "NONE",
      suggestions: ranked.slice(0, 3).map((candidate) => candidate.label),
    };
  }

  const bestRecords = [
    ...new Set(
      ranked
        .filter((candidate) => candidate.distance === best.distance)
        .map((candidate) => candidate.record)
    ),
  ];

  if (bestRecords.length !== 1) {
    return {
      status: "AMBIGUOUS",
      records: bestRecords,
      suggestions: [
        ...new Set(
          ranked
            .filter((candidate) => candidate.distance === best.distance)
            .map((candidate) => candidate.label)
        ),
      ].slice(0, 5),
    };
  }

  const secondDistinct = ranked.find(
    (candidate) =>
      candidate.record !== bestRecords[0] &&
      candidate.distance <= threshold
  );

  if (secondDistinct && secondDistinct.distance === best.distance) {
    return {
      status: "AMBIGUOUS",
      records: [
        bestRecords[0],
        secondDistinct.record,
      ],
      suggestions: [best.label, secondDistinct.label],
    };
  }

  return {
    status: "MATCH",
    record: bestRecords[0],
    matchedLabel: best.label,
    fuzzy: true,
  };
}
