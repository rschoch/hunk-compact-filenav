/**
 * hunk-compact-filenav: a files pane that shortens the middle of deep paths.
 *
 * Each changed directory is stated once as a dim header, keeping the module and
 * the immediate parent package and eliding what is between them, so the row
 * beneath carries the filename alone.
 */

import { useEffect, useMemo, useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type {
  ExtensionCommandContext,
  ExtensionDiffFile,
  ExtensionPaneProps,
  ExtensionPaneTheme,
  HunkExtensionAPI,
} from "hunkdiff/extension";
import {
  DEFAULT_OPTIONS,
  basename,
  createLabeler,
  resolveHiddenExtensions,
  resolveOptions,
  type CompactOptions,
} from "./src/compact.ts";
import { groupByDirectory, resolveHeaderLabels } from "./src/groups.ts";
import { COMPACT_MODE, isNative, nextMode, type PresentationMode } from "./src/mode.ts";
import {
  headerWidth,
  layoutRow,
  nameWidth,
  resolveStatsColumn,
  rowStats,
  type RowInput,
  type RowLayout,
  type RowMarker,
  type RowStat,
} from "./src/rows.ts";

/**
 * Must match the install name, since Hunk namespaces commands as
 * `<extensionId>.<commandId>` and the id is the folder (or file) name.
 */
const EXTENSION_ID = "hunk-compact-filenav";
const PANE_ID = "compact";
const TOGGLE_COMMAND = `${EXTENSION_ID}.toggle-pane`;
/** The literal built-in files pane, which `replaces` only leaves closed. */
const BUILTIN_FILES_PANE = "hunk:files";

/**
 * Read once at load and never mutated afterwards, so the pane needs no store:
 * the only thing the keybinding changes is which pane owns the slot, and that is
 * the host's state, not ours.
 */
let options: CompactOptions = DEFAULT_OPTIONS;
let mode: PresentationMode = COMPACT_MODE;

/**
 * Move ownership of the files slot between this pane and the built-in one.
 *
 * `panes` addresses literal panes rather than replacement slots, so the built-in
 * pane this extension claimed at registration is still reachable by its key,
 * because it was only left closed, not discarded. A slot nobody had open stays
 * closed, so cycling never forces the sidebar back onto someone who hid it.
 */
function handOver(ctx: ExtensionCommandContext, from: string, to: string): void {
  const wasOpen = ctx.panes.isOpen(from);
  ctx.panes.close(from);
  if (wasOpen) ctx.panes.open(to);
}

function markerFor(file: ExtensionDiffFile): RowMarker {
  if (file.isUntracked === true) return "?";
  switch (file.changeType) {
    case "new":
      return "A";
    case "deleted":
      return "D";
    case "rename-pure":
    case "rename-changed":
      return "R";
    default:
      return "M";
  }
}

function markerColor(marker: RowMarker, theme: ExtensionPaneTheme): string {
  switch (marker) {
    case "?":
      return theme.fileUntracked;
    case "A":
      return theme.fileNew;
    case "D":
      return theme.fileDeleted;
    case "R":
      return theme.fileRenamed;
    default:
      return theme.fileModified;
  }
}

function statColor(kind: RowStat["kind"], theme: ExtensionPaneTheme): string {
  switch (kind) {
    case "note":
      return theme.noteBorder;
    case "addition":
      return theme.badgeAdded;
    default:
      return theme.badgeRemoved;
  }
}

/**
 * One line of the pane: either a directory heading or a file.
 *
 * Headers are rows in the list rather than nesting in the component tree, so the
 * scrollbox measures the pane the same way it does for a flat list.
 */
type DisplayRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "file"; key: string; id: string; layout: RowLayout };

function CompactFilesPane({
  files,
  selectedFileId,
  width,
  height,
  theme,
  keybindings,
  actions,
}: ExtensionPaneProps) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  const geometry = useMemo(() => {
    const inputs: RowInput[] = files.map((file) => ({
      path: file.path,
      additions: file.stats.additions,
      deletions: file.stats.deletions,
      statsTruncated: file.statsTruncated === true,
      noteCount: file.agent?.annotations.length ?? 0,
      marker: markerFor(file),
    }));
    // Every row sits under a directory header, so it is indented by one column.
    const indent = 1;
    // One stats column for the whole changeset, so the counts line up.
    const statsColumn = resolveStatsColumn(inputs.map(rowStats), width, indent);
    // Rows show bare filenames, so that is what the extension rule has to judge.
    // The directories are on the headers and never compete for a filename's room.
    const subjects = inputs.map((input) => basename(input.path));
    const hidden = resolveHiddenExtensions(subjects, nameWidth(width, statsColumn, indent), options);
    // A joined string rather than the array, so a recomputed-but-identical
    // verdict does not throw away the label cache below.
    return { inputs, indent, statsColumn, hiddenKey: hidden.join(" ") };
  }, [files, width]);

  // Survives the row memo, which cannot rely on `files` keeping its identity.
  const label = useMemo(
    () => createLabeler(options, geometry.hiddenKey === "" ? [] : geometry.hiddenKey.split(" ")),
    [geometry.hiddenKey],
  );

  const rows = useMemo(() => {
    const { inputs, indent, statsColumn } = geometry;
    const row = (index: number, name?: string): DisplayRow => ({
      kind: "file",
      key: files[index]!.id,
      id: files[index]!.id,
      layout: layoutRow(inputs[index]!, width, statsColumn, options, label, indent, name),
    });

    const groups = groupByDirectory(inputs.map((input) => input.path));
    const headers = resolveHeaderLabels(
      groups.map((group) => group.dir),
      headerWidth(width),
      options,
    );
    const display: DisplayRow[] = [];
    groups.forEach((group, groupIndex) => {
      const header = headers[groupIndex]!;
      // Root-level files have no directory to announce; they stand on their own.
      if (header !== "") {
        display.push({ kind: "header", key: `dir-${groupIndex}-${header}`, label: header });
      }
      for (const index of group.members) {
        display.push(row(index, header === "" ? undefined : basename(inputs[index]!.path)));
      }
    });
    return display;
  }, [files, width, label, geometry]);

  // Following the review's selection is the pane's job, not the host's.
  useEffect(() => {
    if (selectedFileId !== null) scrollRef.current?.scrollChildIntoView(`row-${selectedFileId}`);
  }, [selectedFileId]);

  const chord = keybindings.getKeys(TOGGLE_COMMAND)[0];
  const header = ` ${files.length} file${files.length === 1 ? "" : "s"}${
    chord === undefined ? "" : ` · ${chord} for built-in`
  }`;

  return (
    <box style={{ width: "100%", height: "100%" }}>
      <text
        content={header.slice(0, Math.max(0, width))}
        style={{ fg: theme.muted, bg: theme.panel }}
      />
      <scrollbox
        ref={scrollRef}
        width="100%"
        height={Math.max(1, height - 1)}
        scrollY={true}
        focused={false}
      >
        {rows.map((entry) => {
          if (entry.kind === "header") {
            return (
              <box
                key={entry.key}
                style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: theme.panel }}
              >
                <box style={{ width: 1, height: 1 }} />
                <text content={entry.label} style={{ fg: theme.muted }} />
              </box>
            );
          }
          const { id, layout } = entry;
          const selected = id === selectedFileId;
          const rowBackground = selected ? theme.panelAlt : theme.panel;
          return (
            <box
              key={id}
              id={`row-${id}`}
              style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: rowBackground }}
              onMouseDown={() => actions.selectFile(id)}
            >
              {/* Selection reads as a bar in the margin, so the row keeps its own colors. */}
              <box
                style={{ width: 1, height: 1, backgroundColor: selected ? theme.accent : rowBackground }}
              />
              <box style={{ flexGrow: 1, height: 1, flexDirection: "row", backgroundColor: rowBackground }}>
                {layout.indent > 0 && <text content={" ".repeat(layout.indent)} />}
                <text content={`${layout.marker} `} style={{ fg: markerColor(layout.marker, theme) }} />
                {layout.dirs.length > 0 && <text content={layout.dirs} style={{ fg: theme.muted }} />}
                <text
                  content={layout.filename + " ".repeat(layout.pad)}
                  style={{ fg: theme.text }}
                />
                {layout.statsSection > 0 && (
                  <box
                    style={{
                      width: layout.statsSection,
                      height: 1,
                      flexDirection: "row",
                      justifyContent: "flex-end",
                      backgroundColor: rowBackground,
                    }}
                  >
                    {layout.stats.map((stat, index) => (
                      <box key={stat.kind} style={{ height: 1, flexDirection: "row" }}>
                        {index > 0 && (
                          <text content=" " style={{ fg: selected ? theme.text : theme.muted }} />
                        )}
                        <text content={stat.text} style={{ fg: statColor(stat.kind, theme) }} />
                      </box>
                    ))}
                  </box>
                )}
              </box>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}

export default function (hunk: HunkExtensionAPI): void {
  options = resolveOptions(hunk.config, (message) =>
    hunk.log(`[${EXTENSION_ID}] ignoring invalid config: ${message}`),
  );

  hunk.registerPane({
    id: PANE_ID,
    title: "Files",
    placement: "left",
    replaces: "hunk:files",
    component: CompactFilesPane,
  });

  hunk.registerCommand(
    { id: "toggle-pane", title: "Toggle compact files pane", key: "ctrl+p" },
    (ctx) => {
      const next = nextMode(mode);
      mode = next;

      if (isNative(next)) {
        handOver(ctx, PANE_ID, BUILTIN_FILES_PANE);
        ctx.notify("Files: built-in pane");
        return;
      }
      handOver(ctx, BUILTIN_FILES_PANE, PANE_ID);
      ctx.notify("Files: compact pane");
    },
  );
}
