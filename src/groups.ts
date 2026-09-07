/**
 * Directory grouping for the files pane.
 *
 * A changeset in a package-per-directory codebase touches a handful of files per
 * directory, and the directory is the same on every one of those rows. Stating it
 * once as a header and giving each row's full width to the filename says the same
 * thing in fewer columns. The built-in pane does this too, in its narrow layout,
 * and it is the part of that layout worth keeping.
 *
 * What is not worth keeping is how it fits the header: clipping the end turns
 * `.../src/main/...` and `.../src/test/...` into two headers that read alike, so
 * the pane asks you to guess which group you are looking at. Headers here elide
 * their middle instead and grow their head until no two of them collide.
 */

import { clip, type CompactOptions } from "./compact.ts";

/** Files that share a directory, in the order the host delivered them. */
export interface FileGroup {
  /** Directory the group's files live in, without a trailing slash; `""` at the root. */
  dir: string;
  /** Indices into the input array, so callers keep their own row data. */
  members: number[];
}

function dirname(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/**
 * Split paths into contiguous runs that share a directory.
 *
 * Contiguous rather than gathered: the host decides the file order, and a pane
 * that reorders rows breaks `j`/`k` against what the reader sees. A directory
 * that appears in two separate runs therefore gets two headers, which is what
 * the built-in pane does as well.
 */
export function groupByDirectory(paths: readonly string[]): FileGroup[] {
  const groups: FileGroup[] = [];
  paths.forEach((path, index) => {
    const dir = dirname(path);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.dir === dir) last.members.push(index);
    else groups.push({ dir, members: [index] });
  });
  return groups;
}

/** Index of the first segment at which two paths differ. */
function firstDivergence(a: readonly string[], b: readonly string[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return i;
  }
  return shared;
}

/**
 * Render a directory keeping only the segments in `kept`, with each dropped run
 * collapsed to a single ellipsis.
 *
 * Taking a set of positions rather than a prefix length is what lets a header
 * keep a segment out of its middle: at narrow widths the segment that tells two
 * headers apart may be the only one there is room for, and the leading module has
 * to go instead of it.
 *
 * The trailing slash is part of the label: it is what makes a header read as a
 * place rather than as a file.
 */
function buildHeader(
  segments: readonly string[],
  kept: ReadonlySet<number>,
  ellipsis: string,
): string {
  const parts: string[] = [];
  let dropped = false;
  segments.forEach((segment, index) => {
    if (kept.has(index)) {
      if (dropped) parts.push(ellipsis);
      dropped = false;
      parts.push(segment);
    } else {
      dropped = true;
    }
  });
  return `${parts.join("/")}/`;
}

/** Positions `0..count-1`, clamped, plus every position in `extra`. */
function keep(count: number, ...extra: number[]): Set<number> {
  const kept = new Set<number>();
  for (let i = 0; i < count; i++) kept.add(i);
  for (const index of extra) {
    if (index >= 0) kept.add(index);
  }
  return kept;
}

/**
 * Label every group's directory, elided to `budget` and distinct from the others.
 *
 * Two directories that survive compaction as the same string are worse than one
 * that is merely long: the reader cannot tell the groups apart at all. So a
 * colliding set grows its head until it covers the segment where the members
 * actually diverge (`src/main` against `src/test`, or two modules with the same
 * inner package), and every member of the set grows equally, because headers that
 * differ in shape are read as differing in content.
 *
 * Where the disambiguated form does not fit, the leading segments go before the
 * disambiguating one does: a header reading `…/test/…/service/` still tells you
 * which of two groups you are in, where one clipped to `inventory-module/sr…`
 * tells you nothing that its neighbour does not also say.
 */
export function resolveHeaderLabels(
  dirs: readonly string[],
  budget: number,
  options: CompactOptions,
): string[] {
  const segments = dirs.map((dir) => dir.split("/").filter((part) => part.length > 0));
  const prefixKeep = dirs.map(() => Math.max(0, options.keepPrefixSegments));
  /** Segment that must stay visible for this header to differ from a neighbour. */
  const required = dirs.map(() => -1);

  // Collisions are resolved on the widest form, so the verdict does not change
  // with the pane width and headers do not reshuffle as the sidebar is dragged.
  const buckets = new Map<string, number[]>();
  dirs.forEach((_, index) => {
    const key = buildHeader(
      segments[index]!,
      keep(prefixKeep[index]!, segments[index]!.length - 2, segments[index]!.length - 1),
      options.ellipsis,
    );
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [index]);
    else bucket.push(index);
  });

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    let divergence = 0;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        divergence = Math.max(
          divergence,
          firstDivergence(segments[bucket[i]!]!, segments[bucket[j]!]!),
        );
      }
    }
    // Every member of the set grows by the same amount: headers that differ in
    // shape are read as differing in content.
    for (const index of bucket) {
      prefixKeep[index] = Math.max(prefixKeep[index]!, divergence + 1);
      required[index] = divergence;
    }
  }

  return dirs.map((dir, index) => {
    if (dir === "") return "";
    const parts = segments[index]!;
    const leaf = parts.length - 1;
    // Widest first, shedding one thing per rung: the head shrinks a segment at a
    // time, and each size is tried with and without the parent package. The leaf
    // and the disambiguating segment survive every rung, the first because a
    // header that does not name its own directory says nothing, the second
    // because dropping it merges this header into a neighbour's.
    const ladder: Set<number>[] = [];
    for (let head = Math.max(prefixKeep[index]!, 1); head >= 0; head--) {
      ladder.push(keep(head, required[index]!, leaf - 1, leaf));
      ladder.push(keep(head, required[index]!, leaf));
    }

    const full = `${dir}/`;
    if (!options.alwaysCompact && full.length <= budget) return full;
    for (const kept of ladder) {
      const candidate = buildHeader(parts, kept, options.ellipsis);
      if (candidate.length <= budget) return candidate;
    }
    return clip(buildHeader(parts, keep(0, required[index]!, leaf), options.ellipsis), budget, options.ellipsis);
  });
}
