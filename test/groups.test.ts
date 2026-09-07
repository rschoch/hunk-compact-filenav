import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_OPTIONS, type CompactOptions } from "../src/compact.ts";
import { groupByDirectory, resolveHeaderLabels } from "../src/groups.ts";

const options: CompactOptions = DEFAULT_OPTIONS;

const MAIN = "inventory-module/src/main/java/com/acme/depot/warehouse/stock/service";
const TEST = "inventory-module/src/test/java/com/acme/depot/warehouse/stock/service";
const SHIPPING = "shipping-module/src/main/java/com/acme/depot/warehouse/shipping/service";

function headers(dirs: readonly string[], budget: number): string[] {
  return resolveHeaderLabels(dirs, budget, options);
}

test("files sharing a directory become one group", () => {
  const groups = groupByDirectory([`${MAIN}/A.java`, `${MAIN}/B.java`, `${TEST}/ATest.java`]);
  assert.deepEqual(
    groups.map((group) => group.members),
    [[0, 1], [2]],
  );
  assert.equal(groups[0]!.dir, MAIN);
});

test("a directory that reappears later gets its own group rather than reordering rows", () => {
  const groups = groupByDirectory([`${MAIN}/A.java`, `${TEST}/ATest.java`, `${MAIN}/B.java`]);
  assert.deepEqual(
    groups.map((group) => group.members),
    [[0], [1], [2]],
  );
});

test("a root-level file groups under the empty directory", () => {
  const groups = groupByDirectory(["README.md", `${MAIN}/A.java`]);
  assert.equal(groups[0]!.dir, "");
  assert.equal(headers([""], 40)[0], "");
});

test("a header keeps its module and leaf package and elides the middle", () => {
  assert.equal(headers([MAIN], 34)[0], "inventory-module/…/stock/service/");
});

test("a header that fits is left alone", () => {
  assert.equal(headers(["ui/src/components/stock"], 40)[0], "ui/src/components/stock/");
});

test("colliding headers grow their head until they differ", () => {
  const [main, test_] = headers([MAIN, TEST], 44);
  assert.equal(main, "inventory-module/src/main/…/stock/service/");
  assert.equal(test_, "inventory-module/src/test/…/stock/service/");
  assert.notEqual(main, test_);
});

test("headers that already differ do not grow", () => {
  assert.deepEqual(headers([MAIN, SHIPPING], 40), [
    "inventory-module/…/stock/service/",
    "shipping-module/…/shipping/service/",
  ]);
});

test("a header drops its parent package before its head", () => {
  assert.equal(headers([MAIN], 27)[0], "inventory-module/…/service/");
});

test("a header too narrow for its module keeps as much of the tail as fits", () => {
  assert.equal(headers([MAIN], 26)[0], "…/stock/service/");
});

test("a narrow header gives up its module before the segment that disambiguates it", () => {
  assert.deepEqual(headers([MAIN, TEST], 20), ["…/main/…/service/", "…/test/…/service/"]);
});

test("a header with nowhere left to shrink is clipped rather than left overflowing", () => {
  const label = headers([MAIN], 6)[0]!;
  assert.equal(label.length, 6);
  assert.ok(label.endsWith(options.ellipsis), label);
});

test("collisions are resolved the same way at every width", () => {
  for (let budget = 20; budget <= 60; budget++) {
    const [main, test_] = headers([MAIN, TEST], budget);
    if (main === test_) assert.fail(`headers collide at budget ${budget}: ${main}`);
  }
});

test("three-way collisions grow every member of the set equally", () => {
  const dirs = [MAIN, TEST, "inventory-module/src/it/java/com/acme/depot/warehouse/stock/service"];
  const labels = headers(dirs, 44);
  assert.equal(new Set(labels).size, 3);
  assert.deepEqual(
    labels.map((label) => label.split("/")[2]),
    ["main", "test", "it"],
  );
});

test("always_compact elides a header that would have fitted", () => {
  const compact = { ...options, alwaysCompact: true };
  assert.equal(
    resolveHeaderLabels(["ui/src/components/stock"], 40, compact)[0],
    "ui/…/components/stock/",
  );
});

test("a header keeps its module alongside the disambiguating segment while both fit", () => {
  assert.deepEqual(headers([MAIN, TEST], 34), [
    "inventory-module/…/main/…/service/",
    "inventory-module/…/test/…/service/",
  ]);
});
