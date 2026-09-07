# hunk-compact-filenav

An alternative files pane for [Hunk](https://hunk.dev) that shows compact file
paths, for deeply nested file and package structures. `ctrl+p` cycles back to the
built-in pane at any time.

<table>
<tr><th align="left">built-in filenav pane</th><th align="left">hunk-compact-filenav</th></tr>
<tr>
<td valign="top"><img src="media/built-in-tree.svg" alt="The built-in pane's tree, one row per directory segment"></td>
<td valign="top"><img src="media/pane.svg" alt="hunk-compact-filenav: dim directory headers with full filenames beneath them"></td>
</tr>
</table>

The same eight changed files, each pane at the width Hunk gives it in the same
terminal. The tree on the left runs past the bottom of the sidebar before it
reaches `ui/`, and four of its five visible filenames are cut to a prefix. On the
right every directory is named once, in grey, and the row below it is just the
filename.

## How it differs

### One row per directory, not one per segment

The tree spends ten rows getting to the first changed file:

```
inventory-module/
  src/
    main/
      java/
        com/
          acme/
            depot/
              warehouse/
                stock/
                  service/
                    M StockLeve… +5 -2
```

Here that is two rows, and the name is intact:

```
…/main/…/stock/service/
 M StockLevelService  +5 -2
```

### Narrow sidebars: same idea, better cut

Credit where it is due: below 32 columns of content the built-in pane drops the
tree by itself and switches to a flat list with grey directory headers, which is
exactly the right shape. It just cuts everything off at the end:

```
inventory-module/sr.
 M StockLevel… +5 -2
 M StockReser… +5 -1
 A StockReser…   +20
inventory-module/sr.
 M StockLevel…    +6
```

Both headers now read `inventory-module/sr.`, because `src/main` and `src/test`
differ after the cut. `StockLevelService.java` and `StockLevelServiceTest.java`
both read `StockLevel…`. Two headers you cannot tell apart, and two rows you
cannot tell apart, in a six row list.

This pane cuts headers in the middle and filenames at the front, so the parts that
actually differ survive:

```
…/main/…/stock/service/
 M StockLevelService
 M StockReservation
 A StockReservationService
…/test/…/stock/service/
 M StockLevelServiceTest
```

Headers are checked against each other before they are drawn. If two would come
out the same, the segment where they diverge (`main` against `test`) is kept, at
any width.

Filenames keep their end because that is where they differ. Inside one directory
you get `StockLevelService`, `StockLevelRepository`, `StockLevelValidator`: the
front is shared, the back is the answer.

### Extensions go only when they say nothing

Five of the eight files above are `.java`, so `.java` is repetition and gets
dropped. `.ts`, `.vue` and `.md` are one row each, so they stay:

```
 M StockLevelService          (.java, dropped)
 M stock.ts                   (kept)
 M StockLevelChip.vue         (kept)
 M stock-reconciliation.md    (kept)
```

Unless dropping would make two rows read alike. `StockLevelService.java` next to
`stockLevelService.ts` keeps both extensions, since without them they are the same
row twice.

### Counts go before names do

In a very narrow pane `+12 -3` is dropped first, and the filename stays whole.
Which file a row is beats how many lines it changed.

All of this is decided against the changeset in front of you and the width the pane
has, not by a fixed rule, so the same file can look different in another diff.
That is what keeps the labels short.

## Install

```bash
hunk extension install rschoch/hunk-compact-filenav
```

Pin a release if you'd rather not track `main`:

```bash
hunk extension install rschoch/hunk-compact-filenav@v0.1.0
```

Or, from a local checkout:

```bash
hunk extension install /path/to/hunk-compact-filenav
```

Either way the directory name must stay `hunk-compact-filenav`: Hunk derives the
extension id from it, and the id namespaces the config table and the command.

Needs **Hunk 0.21.1 or newer** (extension API 16). Handing the files slot back to
the built-in pane uses the pane controls added in that API, so the manifest
declares `apiVersion` and an older Hunk will decline to install rather than fail
halfway.

To try it without installing:

```bash
hunk diff --extension /path/to/hunk-compact-filenav
```

## Getting the built-in pane back

`ctrl+p` hands the files slot to Hunk's own pane, the real one, untouched. Pressing
it again takes the slot back. Those are the only two states.

It works because `replaces` does not discard the pane it claims, it only leaves it
closed, and pane controls address literal panes rather than replacement slots. So
the command closes this extension's pane and opens `hunk:files`, then reverses that
on the way out. A slot nobody had open stays closed, so the toggle never forces the
sidebar back onto someone who hid it.

The hand-back is runtime-only and deliberately not a config value: starting Hunk
with this pane switched off would mean installing an extension in order to not use
it. Uninstall it, or drop the `--extension` flag, for that.

While the built-in pane is active, Hunk's own files-pane toggle follows the
*resolved* owner of the slot, which is this extension, so use `ctrl+p` rather than
that key to move between the two.

## Colors

The row mirrors Hunk's own `FileListItem`, reading every color from the live theme
the host hands the pane, so switching themes switches this pane with it:

| Part                        | Theme slot                                                       |
| --------------------------- | ---------------------------------------------------------------- |
| directory headers           | `muted`                                                          |
| filename                    | `text`                                                           |
| `A` / `D` / `R` / `M` / `?` | `fileNew` / `fileDeleted` / `fileRenamed` / `fileModified` / `fileUntracked` |
| `+12`                       | `badgeAdded`                                                     |
| `-3`                        | `badgeRemoved`                                                   |
| `*2` (agent notes)          | `noteBorder`                                                     |
| selected row                | `panelAlt` background, `accent` bar in the left margin            |

Selection is a bar in the margin rather than a recolored row, so a selected row
still shows its change color and its counts. Counts follow the built-in's
vocabulary too: zero is omitted instead of printed as `-0`, truncated stats are
marked `+51+`, and agent review notes appear as `*2`.

## Configuration

```toml
[extension.hunk-compact-filenav]
keep_prefix_segments = 1   # leading directories always shown in full
keep_suffix_segments = 1   # trailing directories always shown in full
always_compact = false     # compact even when the full path would fit
keep_extension = "auto"    # "auto" | "always" | "never" (see above)
ellipsis = "…"             # marker for what was dropped (max 3 columns)
```

`keep_prefix_segments = 1` keeps the module (`inventory-module`) and
`keep_suffix_segments = 1` keeps the package the file lives in (`service`). Raise
`keep_suffix_segments` to `2` for `…/stock/service/`. Set `always_compact = true`
to keep every header on the same shape rather than letting short directories render
in full. `keep_extension = "always"` turns the frequency rule off, `"never"` drops
every extension the collision check allows.

A collision between two headers overrides `keep_prefix_segments`: the segment that
tells them apart is kept regardless, since a header you cannot tell from its
neighbour is not worth the row it costs.

Invalid values are ignored with a diagnostic rather than failing the load.

## Limits

This replaces the built-in files pane (`replaces: "hunk:files"`), so while it is
active these are the gaps against it. `ctrl+p` gets all of it back.

- **No tree.** Directories are one flat level of headers, not nested.
- **No windowing.** Every row is mounted, where the built-in renders only the rows
  near the viewport plus sized spacers. This is the pane's real scaling limit on
  changesets of many hundreds of files, not the string work, which is cached.
- **Renames show one path.** The built-in renders `old -> new` when a rename
  changed the filename; here the marker is `R` and the path is the new one.

Filtering, selection and `[`/`]` navigation are host-owned and unaffected: `files`
arrives already filtered, and clicking a row routes through the same review
controller the built-in pane uses.

Only the *display* is changed. `file.path` is untouched, so
`hunk session comment add --file <path>` and workspace writes keep taking real
paths. (Rewriting paths in `transformChangeset` would be fewer lines but would
break both.)

## Performance

A label depends only on the path, the column budget and the options, never on the
selection, so labels are cached per options set, keyed by budget and path. Pane
props refresh on every selection change, and whether `files` keeps its array
identity across those refreshes is the host's business, so the cache is what keeps
a busted `useMemo` cheap. Row assembly per render:

| | 31 files | 200 files | 1000 files |
| --- | --- | --- | --- |
| recompacting every row | 0.15 ms | 0.77 ms | 3.71 ms |
| cached labeler | 0.02 ms | 0.12 ms | 0.45 ms |

The cache holds 8192 entries and is dropped wholesale when it overflows. Candidate
labels are tested as they are built rather than materialized as a ladder, and width
measurement takes an ASCII fast path, since paths are almost always ASCII.

Header collisions are resolved once per changeset rather than per render, and on
the widest form of each header, so headers do not reshuffle as the sidebar is
dragged.

## Development

```bash
npm install
npm run typecheck
npm test
```

The compaction logic is pure and lives in `src/`, so it is unit-tested without a
terminal. Hunk's TUI needs a real terminal and owns stdout, so do not pipe
`hunk diff` to test the pane; run it interactively.
