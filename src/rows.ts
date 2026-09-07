/**
 * Row layout for the files pane.
 *
 * Deliberately mirrors Hunk's own `FileListItem` geometry and stat vocabulary, so
 * a compacted row is the built-in row with a shorter name in it: a one-column
 * selection bar, a two-column change marker, the name, and a right-aligned stats
 * column whose width is shared by every row. Cycling between a compaction style
 * and `native` should change the text, not the look.
 *
 * Rows are described rather than rendered, because a row is several differently
 * colored spans (grey directories, a bright filename, green and red counts) and
 * the widths have to add up before any of it reaches the terminal.
 */

import { clip, compactPath, type CompactOptions, type Labeler } from "./compact.ts";

/** The five states a reviewed file can be in, as a one-column marker. */
export type RowMarker = "A" | "D" | "R" | "M" | "?";

export interface RowInput {
  path: string;
  additions: number;
  deletions: number;
  statsTruncated: boolean;
  /** Agent review notes on this file, shown as `*n` like the built-in pane. */
  noteCount?: number;
  marker: RowMarker;
}

/** One right-aligned count, tagged so the pane can color it. */
export interface RowStat {
  kind: "note" | "addition" | "deletion";
  text: string;
}

/** Columns spent on the selection bar plus the built-in's own trailing column. */
const RESERVED = 2;
/** Marker plus the space after it. */
const MARKER_WIDTH = 2;
/**
 * Below this the stats column is dropped rather than starving the path.
 *
 * Set to roughly a full Java class name: knowing *which* file a row is beats
 * knowing how many lines it changed, and giving the name these columns back is
 * what keeps filenames off the clipping path in the first place.
 */
const MIN_NAME_WIDTH = 18;

/** `+12`, `-3`, `*2`. Zero counts are omitted, exactly like the built-in. */
function statText(prefix: string, value: number, truncated = false): string | null {
  return value > 0 ? `${prefix}${value}${truncated ? "+" : ""}` : null;
}

/** Notes first, then additions, then deletions. */
export function rowStats(input: RowInput): RowStat[] {
  const stats: RowStat[] = [];
  const note = statText("*", input.noteCount ?? 0);
  if (note !== null) stats.push({ kind: "note", text: note });
  const additions = statText("+", input.additions, input.statsTruncated);
  if (additions !== null) stats.push({ kind: "addition", text: additions });
  const deletions = statText("-", input.deletions);
  if (deletions !== null) stats.push({ kind: "deletion", text: deletions });
  return stats;
}

/** Width of one row's stats, counting the single space between each. */
export function statsWidth(stats: readonly RowStat[]): number {
  return stats.reduce((total, stat, index) => total + stat.text.length + (index > 0 ? 1 : 0), 0);
}

export interface RowLayout {
  marker: RowMarker;
  /** Columns of indent before the marker; `1` under a group header, `0` otherwise. */
  indent: number;
  /** Leading directories including the trailing slash, painted muted; may be empty. */
  dirs: string;
  /** The filename, painted as ordinary text so it stays the brightest thing in the row. */
  filename: string;
  /** Spaces after the filename that keep the stats column aligned. */
  pad: number;
  stats: readonly RowStat[];
  /** Width of the shared stats column including its leading gap; `0` when dropped. */
  statsSection: number;
}

/**
 * Split a compacted label into the part to mute and the part to keep bright.
 *
 * The filename is what the eye is looking for, so everything up to and including
 * the last separator is directory context.
 */
export function splitLabel(label: string): { dirs: string; filename: string } {
  const cut = label.lastIndexOf("/");
  if (cut < 0) return { dirs: "", filename: label };
  return { dirs: label.slice(0, cut + 1), filename: label.slice(cut + 1) };
}

/**
 * Columns available to the name once the marker and stats column are paid for.
 *
 * The stats column is shared across rows, so it is passed in rather than derived
 * per row, which is what keeps the counts in a straight line.
 */
export function nameWidth(paneWidth: number, statsColumn: number, indent = 0): number {
  const section = statsColumn > 0 ? statsColumn + 1 : 0;
  return Math.max(1, paneWidth - RESERVED - MARKER_WIDTH - section - indent);
}

/** Columns a group header may use: no marker, no stats, one column of indent. */
export function headerWidth(paneWidth: number): number {
  return Math.max(1, paneWidth - RESERVED - 1);
}

/**
 * Decide the shared stats column for a whole changeset.
 *
 * Returns `0` when the pane is too narrow to afford both, because a readable
 * filename is worth more than a line count.
 */
export function resolveStatsColumn(
  perRow: readonly (readonly RowStat[])[],
  paneWidth: number,
  indent = 0,
): number {
  const widest = perRow.reduce((max, stats) => Math.max(max, statsWidth(stats)), 0);
  if (widest === 0) return 0;
  return nameWidth(paneWidth, widest, indent) >= MIN_NAME_WIDTH ? widest : 0;
}

/**
 * Lay out one row against an already-resolved stats column.
 *
 * The name is compacted to exactly the columns left over, then padded, so every
 * row is the same width and the stats stay right-aligned.
 */
export function layoutRow(
  input: RowInput,
  paneWidth: number,
  statsColumn: number,
  options: CompactOptions,
  label?: Labeler,
  indent = 0,
  /** Name to fit instead of the path: the bare filename, under a group header. */
  name?: string,
): RowLayout {
  const budget = nameWidth(paneWidth, statsColumn, indent);
  const subject = name ?? input.path;
  const compacted =
    label === undefined ? compactPath(subject, budget, options) : label(subject, budget);
  const fitted = clip(compacted, budget, options.ellipsis);
  const { dirs, filename } = splitLabel(fitted);

  return {
    marker: input.marker,
    indent,
    dirs,
    filename,
    pad: Math.max(0, budget - dirs.length - filename.length),
    stats: statsColumn > 0 ? rowStats(input) : [],
    statsSection: statsColumn > 0 ? statsColumn + 1 : 0,
  };
}
