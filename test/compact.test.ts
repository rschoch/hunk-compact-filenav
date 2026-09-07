import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_OPTIONS,
  compactPath,
  createLabeler,
  resolveHiddenExtensions,
  resolveOptions,
  splitExtension,
  type CompactOptions,
} from "../src/compact.ts";
import { COMPACT_MODE, MODES, NATIVE_MODE, isNative, nextMode } from "../src/mode.ts";
import {
  layoutRow,
  nameWidth,
  resolveStatsColumn,
  rowStats,
  splitLabel,
  statsWidth,
  type RowInput,
} from "../src/rows.ts";

const PACKAGE = "inventory-module/src/main/java/com/acme/depot/warehouse/stock/service";
const JAVA = `${PACKAGE}/StockReservationKey.java`;

function withOptions(overrides: Partial<CompactOptions> = {}): CompactOptions {
  return { ...DEFAULT_OPTIONS, ...overrides };
}

function javaRow(overrides: Partial<RowInput> = {}): RowInput {
  return {
    path: JAVA,
    additions: 51,
    deletions: 0,
    statsTruncated: false,
    noteCount: 0,
    marker: "A",
    ...overrides,
  };
}

test("leaves a path alone when it already fits", () => {
  assert.equal(compactPath(JAVA, 200, withOptions()), JAVA);
});

test("elides the middle but keeps module, parent package, and filename", () => {
  assert.equal(
    compactPath(JAVA, 60, withOptions()),
    "inventory-module/…/service/StockReservationKey.java",
  );
});

test("sheds the parent package before the filename", () => {
  assert.equal(compactPath(JAVA, 45, withOptions()), "inventory-module/…/StockReservationKey.java");
});

test("sheds the module prefix before the filename", () => {
  assert.equal(compactPath(JAVA, 30, withOptions()), "…/StockReservationKey.java");
});

test("clips the filename only as a last resort, keeping its end", () => {
  assert.equal(compactPath(JAVA, 12, withOptions()), "…ionKey.java");
});

test("a clipped filename drops an extension judged uninformative", () => {
  const hidden = new Set([".java"]);
  assert.equal(compactPath(JAVA, 12, withOptions(), hidden), "…ervationKey");
});

test("a hidden extension never eats a dotfile's whole name", () => {
  // `.gitignore` is all extension by a naive reading, so it must have none.
  const hidden = new Set([".gitignore"]);
  assert.equal(compactPath(".gitignore", 6, withOptions(), hidden), "…gnore");
  assert.deepEqual(splitExtension(".gitignore"), [".gitignore", ""]);
  assert.deepEqual(splitExtension("StockLevel.java"), ["StockLevel", ".java"]);
});

test("always_compact skips the untouched path even when it would fit", () => {
  assert.equal(
    compactPath(JAVA, 200, withOptions({ alwaysCompact: true })),
    "inventory-module/…/service/StockReservationKey.java",
  );
});

test("never invents an ellipsis for a path with nothing to elide", () => {
  assert.equal(compactPath("ui/src/App.vue", 20, withOptions()), "ui/src/App.vue");
  assert.equal(compactPath("README.md", 20, withOptions()), "README.md");
});

test("elides a hidden directory's middle like any other", () => {
  assert.equal(
    compactPath(".github/workflows/nested/deep/ci.yml", 30, withOptions()),
    ".github/…/deep/ci.yml",
  );
});

test("honours a wider keep_suffix_segments", () => {
  assert.equal(
    compactPath(JAVA, 70, withOptions({ keepSuffixSegments: 2 })),
    "inventory-module/…/stock/service/StockReservationKey.java",
  );
});

test("a row splits into muted directories and a bright filename", () => {
  const row = layoutRow(javaRow(), 60, 3, withOptions());
  assert.equal(row.dirs, "inventory-module/…/service/");
  assert.equal(row.filename, "StockReservationKey.java");
  assert.equal(row.marker, "A");
});

test("the filename and its padding fill exactly the columns left over", () => {
  const paneWidth = 60;
  const statsColumn = 3;
  const row = layoutRow(javaRow(), paneWidth, statsColumn, withOptions());
  assert.equal(row.dirs.length + row.filename.length + row.pad, nameWidth(paneWidth, statsColumn));
});

test("a whole row never exceeds the pane rectangle", () => {
  for (let paneWidth = 12; paneWidth <= 120; paneWidth++) {
    for (const indent of [0, 1]) {
      const stats = rowStats(javaRow());
      const statsColumn = resolveStatsColumn([stats], paneWidth, indent);
      const row = layoutRow(javaRow(), paneWidth, statsColumn, withOptions(), undefined, indent);
      const used =
        2 + row.indent + 2 + row.dirs.length + row.filename.length + row.pad + row.statsSection;
      assert.ok(used <= paneWidth, `width ${paneWidth} indent ${indent} used ${used}`);
    }
  }
});

test("a row under a header carries the filename alone", () => {
  const row = layoutRow(javaRow(), 40, 3, withOptions(), undefined, 1, "StockReservationKey.java");
  assert.equal(row.dirs, "");
  assert.equal(row.filename, "StockReservationKey.java");
  assert.equal(row.indent, 1);
});

test("zero counts are omitted, like the built-in pane", () => {
  assert.deepEqual(rowStats(javaRow()), [{ kind: "addition", text: "+51" }]);
  assert.deepEqual(rowStats(javaRow({ additions: 0, deletions: 7 })), [
    { kind: "deletion", text: "-7" },
  ]);
  assert.deepEqual(rowStats(javaRow({ additions: 0, deletions: 0 })), []);
});

test("truncated additions are marked with a trailing plus", () => {
  assert.deepEqual(rowStats(javaRow({ additions: 9, statsTruncated: true })), [
    { kind: "addition", text: "+9+" },
  ]);
});

test("notes lead the stats column", () => {
  assert.deepEqual(rowStats(javaRow({ noteCount: 2, additions: 3, deletions: 4 })), [
    { kind: "note", text: "*2" },
    { kind: "addition", text: "+3" },
    { kind: "deletion", text: "-4" },
  ]);
});

test("the stats column is wide enough for the widest row", () => {
  const rows = [
    rowStats(javaRow({ additions: 5, deletions: 1 })),
    rowStats(javaRow({ additions: 1200, deletions: 340 })),
  ];
  assert.equal(statsWidth(rows[0]!), 5);
  assert.equal(resolveStatsColumn(rows, 80), statsWidth(rows[1]!));
});

test("a narrow pane drops the stats column rather than starve the path", () => {
  assert.equal(resolveStatsColumn([rowStats(javaRow())], 26), 3);
  assert.equal(resolveStatsColumn([rowStats(javaRow())], 25), 0);
  const row = layoutRow(javaRow(), 14, 0, withOptions());
  assert.deepEqual(row.stats, []);
  assert.equal(row.statsSection, 0);
  assert.ok(row.filename.length > 0);
});

test("an indented row pays for its indent out of the stats column", () => {
  assert.equal(resolveStatsColumn([rowStats(javaRow())], 26, 1), 0);
  assert.equal(resolveStatsColumn([rowStats(javaRow())], 27, 1), 3);
});

test("a bare filename has no directory part to mute", () => {
  assert.deepEqual(splitLabel("README.md"), { dirs: "", filename: "README.md" });
  assert.deepEqual(splitLabel("ui/src/App.vue"), { dirs: "ui/src/", filename: "App.vue" });
});

test("config is validated and bad values fall back", () => {
  const problems: string[] = [];
  const resolved = resolveOptions(
    { keep_prefix_segments: -2, always_compact: "yes", ellipsis: "" },
    (message) => problems.push(message),
  );
  assert.equal(resolved.keepPrefixSegments, DEFAULT_OPTIONS.keepPrefixSegments);
  assert.equal(resolved.alwaysCompact, DEFAULT_OPTIONS.alwaysCompact);
  assert.equal(resolved.ellipsis, DEFAULT_OPTIONS.ellipsis);
  assert.equal(problems.length, 3);
});

test("config accepts valid values", () => {
  const resolved = resolveOptions({
    keep_prefix_segments: 2,
    keep_suffix_segments: 0,
    always_compact: true,
    keep_extension: "never",
    ellipsis: "..",
  });
  assert.deepEqual(resolved, {
    keepPrefixSegments: 2,
    keepSuffixSegments: 0,
    alwaysCompact: true,
    keepExtension: "never",
    ellipsis: "..",
  });
});

test("an unknown config key is ignored rather than fatal", () => {
  const problems: string[] = [];
  const resolved = resolveOptions({ style: "sideways" }, (message) => problems.push(message));
  assert.deepEqual(resolved, DEFAULT_OPTIONS);
  assert.equal(problems.length, 0);
});

test("an invalid keep_extension falls back with a diagnostic", () => {
  const problems: string[] = [];
  const resolved = resolveOptions({ keep_extension: "sometimes" }, (m) => problems.push(m));
  assert.equal(resolved.keepExtension, DEFAULT_OPTIONS.keepExtension);
  assert.equal(problems.length, 1);
});

const MOSTLY_JAVA = [
  `${PACKAGE}/StockLevelService.java`,
  `${PACKAGE}/StockReservationKey.java`,
  `${PACKAGE}/StockLevelRepository.java`,
  "ui/src/components/stock/StockLevelChip.vue",
  "ui/src/apis/stock.ts",
];

test("a common extension is dropped and a rare one kept", () => {
  assert.deepEqual(resolveHiddenExtensions(MOSTLY_JAVA, 14, withOptions()), [".java"]);
});

test("an extension goes back when hiding it makes two rows read alike", () => {
  // Same stem, two languages: without the extension these rows are one row.
  const fullStack = [`${PACKAGE}/StockLevelService.java`, "ui/src/apis/StockLevelService.ts"];
  assert.deepEqual(resolveHiddenExtensions(fullStack, 12, withOptions()), []);
});

test("keep_extension overrides the frequency rule in both directions", () => {
  assert.deepEqual(
    resolveHiddenExtensions(MOSTLY_JAVA, 14, withOptions({ keepExtension: "always" })),
    [],
  );
  assert.deepEqual(resolveHiddenExtensions(MOSTLY_JAVA, 14, withOptions({ keepExtension: "never" })), [
    ".java",
    ".ts",
    ".vue",
  ]);
});

test("hiding extensions never makes a changeset less distinguishable", () => {
  const options = withOptions();
  for (let budget = 6; budget <= 40; budget++) {
    const hidden = new Set(resolveHiddenExtensions(MOSTLY_JAVA, budget, options));
    const labels = MOSTLY_JAVA.map((path) => compactPath(path, budget, options, hidden));
    const plain = MOSTLY_JAVA.map((path) => compactPath(path, budget, options));
    assert.ok(new Set(labels).size >= new Set(plain).size, `budget ${budget}: ${labels.join(" | ")}`);
  }
});

test("a labeler honours the extensions it was told to hide", () => {
  const label = createLabeler(withOptions(), [".java"]);
  assert.equal(label(JAVA, 12), "…ervationKey");
  assert.equal(label(JAVA, 12), "…ervationKey");
});

test("a cached labeler agrees with compactPath at every budget", () => {
  const options = withOptions();
  const label = createLabeler(options);
  const paths = [
    JAVA,
    "ui/src/components/stock/StockLevelChip.vue",
    "README.md",
    ".github/workflows/ci.yml",
  ];
  for (const path of paths) {
    for (let budget = 1; budget <= 100; budget++) {
      // Twice, so the second read comes from the cache.
      assert.equal(label(path, budget), compactPath(path, budget, options), `${path}@${budget}`);
      assert.equal(
        label(path, budget),
        compactPath(path, budget, options),
        `${path}@${budget} (cached)`,
      );
    }
  }
});

test("a cached labeler does not leak a label across budgets", () => {
  const label = createLabeler(withOptions());
  assert.equal(label(JAVA, 60), "inventory-module/…/service/StockReservationKey.java");
  assert.equal(label(JAVA, 30), "…/StockReservationKey.java");
  assert.equal(label(JAVA, 60), "inventory-module/…/service/StockReservationKey.java");
});

test("a cached labeler stays correct after its cache is dropped", () => {
  const label = createLabeler(withOptions());
  // Exceed LABEL_CACHE_LIMIT so the wholesale clear runs mid-flight.
  for (let i = 0; i < 9000; i++) {
    label(`m${i}/src/main/java/com/acme/pkg/service/File${i}.java`, 40);
  }
  assert.equal(label(JAVA, 60), "inventory-module/…/service/StockReservationKey.java");
});

test("each labeler honours its own options", () => {
  const narrow = createLabeler(withOptions());
  const wide = createLabeler(withOptions({ keepSuffixSegments: 2 }));
  assert.equal(narrow(JAVA, 70), "inventory-module/…/service/StockReservationKey.java");
  assert.equal(wide(JAVA, 70), "inventory-module/…/stock/service/StockReservationKey.java");
});

test("the cycle hands the slot over and takes it back", () => {
  assert.equal(nextMode(COMPACT_MODE), NATIVE_MODE);
  assert.equal(nextMode(NATIVE_MODE), COMPACT_MODE);
  assert.deepEqual([...MODES], [COMPACT_MODE, NATIVE_MODE]);
});

test("only the built-in hand-back counts as native", () => {
  assert.ok(isNative(NATIVE_MODE));
  assert.ok(!isNative(COMPACT_MODE));
});

test("non-ascii paths measure by glyph, not code unit", () => {
  const path = "größe-modul/src/main/java/com/acme/prüfung/service/Prüfbericht.java";
  const compacted = compactPath(path, 45, withOptions());
  assert.ok(Array.from(compacted).length <= 45, compacted);
  assert.ok(compacted.endsWith("Prüfbericht.java"), compacted);
});
