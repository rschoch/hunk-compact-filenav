/**
 * Path compaction for the files pane.
 *
 * Pure string work, kept out of the React entry so it can be unit-tested and
 * reasoned about without a terminal.
 */

/**
 * Whether a filename keeps its extension.
 *
 * `auto` drops it only where it carries no information. See
 * {@link resolveHiddenExtensions}.
 */
export type KeepExtension = "auto" | "always" | "never";

export const KEEP_EXTENSION_MODES: readonly KeepExtension[] = ["auto", "always", "never"];

export interface CompactOptions {
  /** Leading directory segments always shown in full, e.g. the Maven module. */
  keepPrefixSegments: number;
  /** Trailing directory segments always shown in full, e.g. `service`. */
  keepSuffixSegments: number;
  /** Compact even when the untouched path would fit the budget. */
  alwaysCompact: boolean;
  keepExtension: KeepExtension;
  ellipsis: string;
}

export const DEFAULT_OPTIONS: CompactOptions = {
  keepPrefixSegments: 1,
  keepSuffixSegments: 1,
  alwaysCompact: false,
  keepExtension: "auto",
  ellipsis: "…",
};

/** Above this share of a changeset an extension is treated as saying nothing. */
const COMMON_EXTENSION_SHARE = 0.25;

function chars(value: string): string[] {
  return Array.from(value);
}

/** True when every code unit is plain ASCII, so `length` is already the width. */
function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/**
 * Column width of a string.
 *
 * Paths are overwhelmingly ASCII, so the fast path avoids allocating a glyph
 * array per candidate, and this runs once per candidate per row per render.
 */
function width(value: string): number {
  return isAscii(value) ? value.length : chars(value).length;
}

/**
 * Hard-clip the *start* to `budget`, keeping the end of the string.
 *
 * For a path the end is the part worth reading, so an overflowing path gives up
 * its leading directories rather than its filename.
 */
export function clipStart(value: string, budget: number, ellipsis: string): string {
  if (budget <= 0) return "";
  const glyphs = chars(value);
  if (glyphs.length <= budget) return value;
  const mark = chars(ellipsis);
  if (budget <= mark.length) return glyphs.slice(glyphs.length - budget).join("");
  return ellipsis + glyphs.slice(glyphs.length - (budget - mark.length)).join("");
}

/** Hard-clip to `budget`, marking the cut so a truncated row never looks complete. */
export function clip(value: string, budget: number, ellipsis: string): string {
  if (budget <= 0) return "";
  const glyphs = chars(value);
  if (glyphs.length <= budget) return value;
  const mark = chars(ellipsis);
  if (budget <= mark.length) return glyphs.slice(0, budget).join("");
  return glyphs.slice(0, budget - mark.length).join("") + ellipsis;
}

export function basename(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

/** Split a filename into its stem and its extension, dot included. */
export function splitExtension(filename: string): [stem: string, extension: string] {
  const dot = filename.lastIndexOf(".");
  // A leading dot is a hidden file, not an extension: `.gitignore` has no stem.
  if (dot <= 0) return [filename, ""];
  return [filename.slice(0, dot), filename.slice(dot)];
}

/**
 * Fit a filename that cannot fit, keeping its end.
 *
 * Names inside one directory tend to share a prefix and differ in their role
 * suffix: `StockLevelService` next to `StockLevelRepository`, because
 * the directory already carries the domain. Clipping the front therefore keeps
 * what tells two rows apart, where clipping the tail routinely produces several
 * rows that read alike.
 *
 * The extension goes first when it has been judged uninformative, since it is
 * pure repetition in a directory where every file is one language.
 */
export function clipFilename(
  filename: string,
  budget: number,
  ellipsis: string,
  hideExtension: boolean,
): string {
  if (hideExtension) {
    const [stem] = splitExtension(filename);
    if (stem.length > 0) return clipStart(stem, budget, ellipsis);
  }
  return clipStart(filename, budget, ellipsis);
}

/**
 * Render a path keeping `prefixKeep` leading and `suffixKeep` trailing
 * directories intact, with everything in between replaced by the ellipsis.
 *
 * The ellipsis appears only when segments are actually dropped, so the label
 * never claims to hide something it kept.
 */
function build(
  dirs: readonly string[],
  filename: string,
  prefixKeep: number,
  suffixKeep: number,
  ellipsis: string,
): string {
  const head = dirs.slice(0, prefixKeep);
  const tail = suffixKeep > 0 ? dirs.slice(dirs.length - suffixKeep) : [];
  const middle = dirs.slice(prefixKeep, dirs.length - suffixKeep);

  const parts: string[] = [...head];
  if (middle.length > 0) parts.push(ellipsis);
  parts.push(...tail, filename);
  return parts.join("/");
}

/**
 * Fit `path` into `budget` columns, shedding the least useful directories first.
 *
 * The filename and the configured prefix/suffix segments are the last things to
 * go: in a monorepo the module and the immediate parent package carry almost all
 * of the disambiguating information, while the middle (`src/main/java/com/example/…`)
 * repeats across every file.
 */
export function compactPath(
  path: string,
  budget: number,
  options: CompactOptions,
  hiddenExtensions?: ReadonlySet<string>,
): string {
  const { alwaysCompact, ellipsis } = options;
  const segments = path.split("/").filter((segment) => segment.length > 0);

  const filename = segments[segments.length - 1];
  if (filename === undefined) return clip(path, budget, ellipsis);
  const dirs = segments.slice(0, -1);

  const hideExtension =
    hiddenExtensions !== undefined && hiddenExtensions.has(splitExtension(filename)[1]);

  if (dirs.length === 0) return clipFilename(filename, budget, ellipsis, hideExtension);

  const prefixCount = Math.max(0, Math.min(options.keepPrefixSegments, dirs.length));
  const suffixCount = Math.max(0, Math.min(options.keepSuffixSegments, dirs.length - prefixCount));

  // Candidates are tested as they are built: the first one usually wins, so
  // materializing the whole ladder would be garbage on every row of every frame.
  let candidate: string;
  const fits = (value: string): boolean => width(value) <= budget;

  if (!alwaysCompact && fits(path)) return path;

  candidate = build(dirs, filename, prefixCount, suffixCount, ellipsis);
  if (fits(candidate)) return candidate;

  // Give up the trailing packages, then the leading module, then the path entirely.
  for (let keep = suffixCount - 1; keep >= 0; keep--) {
    candidate = build(dirs, filename, prefixCount, keep, ellipsis);
    if (fits(candidate)) return candidate;
  }
  for (let keep = prefixCount - 1; keep >= 0; keep--) {
    candidate = build(dirs, filename, keep, 0, ellipsis);
    if (fits(candidate)) return candidate;
  }
  if (fits(filename)) return filename;
  return clipFilename(filename, budget, ellipsis, hideExtension);
}

/**
 * Decide which extensions to leave off filenames, for one changeset.
 *
 * An extension shared by most of the changeset says almost nothing, since a pane
 * where every row ends in `.java` spends real columns repeating itself, while a
 * rare one is the most informative thing on its row. So common extensions are
 * dropped and rare ones kept.
 *
 * Dropping is then checked rather than trusted: if hiding an extension makes two
 * rows read alike, that extension goes back, because an ambiguous row is worse
 * than a truncated one. A full-stack changeset of `StockLevelService.java` beside
 * `stockLevelService.ts` keeps both extensions for exactly this reason. Restoring one
 * extension can expose a collision in another, so this settles rather than
 * assuming one pass is enough.
 *
 * Depends on the budget, so it belongs to a pane width as much as to a changeset.
 */
export function resolveHiddenExtensions(
  paths: readonly string[],
  budget: number,
  options: CompactOptions,
): readonly string[] {
  if (options.keepExtension === "always" || paths.length === 0) return [];

  const extensions = paths.map((path) => splitExtension(basename(path))[1]);
  const counts = new Map<string, number>();
  for (const extension of extensions) {
    if (extension.length > 0) counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }

  const hidden = new Set<string>();
  for (const [extension, count] of counts) {
    if (options.keepExtension === "never" || count / paths.length > COMMON_EXTENSION_SHARE) {
      hidden.add(extension);
    }
  }
  if (options.keepExtension === "never") return [...hidden].sort();

  for (let pass = 0; pass <= counts.size && hidden.size > 0; pass++) {
    const labels = paths.map((path) => compactPath(path, budget, options, hidden));
    const seen = new Map<string, number>();
    for (const label of labels) seen.set(label, (seen.get(label) ?? 0) + 1);

    const restore = new Set<string>();
    labels.forEach((label, index) => {
      const extension = extensions[index]!;
      if (hidden.has(extension) && (seen.get(label) ?? 0) > 1) restore.add(extension);
    });
    if (restore.size === 0) break;
    for (const extension of restore) hidden.delete(extension);
  }
  return [...hidden].sort();
}

/** Entries retained before the cache is dropped wholesale. */
const LABEL_CACHE_LIMIT = 8192;

/** A memoized `compactPath` bound to one set of options. */
export type Labeler = (path: string, budget: number) => string;

/**
 * Build a labeler that caches by budget and path.
 *
 * A file's label depends only on its path, the column budget and the options,
 * never on the selection. Pane props refresh on every selection change, and
 * whether `files` keeps its array identity across those refreshes is the host's
 * business, so the cache makes a busted memo cost a map lookup per row instead
 * of a fresh compaction. Options are fixed per labeler, which keeps the key a
 * bare path and avoids building a composite key string per row.
 */
export function createLabeler(
  options: CompactOptions,
  hiddenExtensions: readonly string[] = [],
): Labeler {
  const hidden = new Set(hiddenExtensions);
  const byBudget = new Map<number, Map<string, string>>();
  let entries = 0;

  return (path, budget) => {
    let cache = byBudget.get(budget);
    if (cache === undefined) {
      cache = new Map();
      byBudget.set(budget, cache);
    }
    const hit = cache.get(path);
    if (hit !== undefined) return hit;

    const label = compactPath(path, budget, options, hidden);
    if (entries >= LABEL_CACHE_LIMIT) {
      byBudget.clear();
      byBudget.set(budget, (cache = new Map()));
      entries = 0;
    }
    cache.set(path, label);
    entries++;
    return label;
  };
}

/** Read and validate the `[extension.<id>]` table, ignoring anything malformed. */
export function resolveOptions(
  config: Record<string, unknown>,
  onInvalid?: (message: string) => void,
): CompactOptions {
  const resolved: CompactOptions = { ...DEFAULT_OPTIONS };

  for (const [key, field] of [
    ["keep_prefix_segments", "keepPrefixSegments"],
    ["keep_suffix_segments", "keepSuffixSegments"],
  ] as const) {
    const value = config[key];
    if (value === undefined) continue;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 32) {
      resolved[field] = value;
    } else {
      onInvalid?.(`${key} must be an integer between 0 and 32; using ${resolved[field]}`);
    }
  }

  const keepExtension = config.keep_extension;
  if (keepExtension !== undefined) {
    if (
      typeof keepExtension === "string" &&
      (KEEP_EXTENSION_MODES as readonly string[]).includes(keepExtension)
    ) {
      resolved.keepExtension = keepExtension as KeepExtension;
    } else {
      onInvalid?.(
        `keep_extension must be one of ${KEEP_EXTENSION_MODES.join(", ")}; using "${resolved.keepExtension}"`,
      );
    }
  }

  const alwaysCompact = config.always_compact;
  if (alwaysCompact !== undefined) {
    if (typeof alwaysCompact === "boolean") resolved.alwaysCompact = alwaysCompact;
    else onInvalid?.(`always_compact must be a boolean; using ${resolved.alwaysCompact}`);
  }

  const ellipsis = config.ellipsis;
  if (ellipsis !== undefined) {
    if (typeof ellipsis === "string" && ellipsis.length > 0 && width(ellipsis) <= 3) {
      resolved.ellipsis = ellipsis;
    } else {
      onInvalid?.(`ellipsis must be a string of at most 3 columns; using "${resolved.ellipsis}"`);
    }
  }

  return resolved;
}
