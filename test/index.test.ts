import assert from "node:assert/strict";
import test from "node:test";

import {
  coordLabel,
  normalizePlan,
  parseCoordLabel,
  parseView,
  renderPlan,
  transformPlan,
  validatePlan,
  type Plan,
  type RawPlan,
} from "../src/index.js";

const plan: Plan = {
  board: { w: 5, h: 4 },
  parts: [
    {
      id: "part-1",
      name: "Example <part>",
      at: { x: 2, y: 2 },
      size: { w: 3, h: 2 },
      pins: {
        LEFT: { x: 1, y: 1 },
        RIGHT: { x: 3, y: 2 },
      },
    },
  ],
};

test("validates and renders a plan using one-based coordinates", () => {
  assert.doesNotThrow(() => validatePlan(plan));

  const svg = renderPlan(plan);
  assert.match(svg, /<svg[^>]+width="212" height="200" viewBox="0 0 212 200"/);
  assert.match(svg, /Example &lt;part&gt;/);
  assert.match(svg, /data-pin="LEFT" cx="100" cy="112"/);
  assert.match(svg, /data-pin="RIGHT" cx="148" cy="136"/);
  assert.match(svg, /<rect width="100%" height="100%" fill="#181a1f"\/>/);
  assert.match(svg, /class="board-hole"[^>]+fill="#484d55"/);
  assert.match(svg, /\.part-name[^}]+fill: #fff/);
  assert.match(svg, /<rect x="100" y="112"[^>]+stroke="#d6bd63"/);
  assert.match(svg, /data-pin="LEFT"[^>]+fill="#d6bd63"\/>/);
  assert.doesNotMatch(svg, /data-pin="LEFT"[^>]+stroke=/);
  assert.doesNotMatch(svg, /rx=|stroke="#d5d9de"/);
});

test("rejects parts and pins outside their bounds", () => {
  const invalid: Plan = {
    board: { w: 3, h: 3 },
    parts: [
      {
        id: "bad",
        name: "Bad",
        at: { x: 3, y: 3 },
        size: { w: 2, h: 2 },
        pins: { P1: { x: 0, y: 1 } },
      },
    ],
  };

  assert.throws(() => validatePlan(invalid), /must fit inside the board/);
});

test("parses the view argument and defaults to top", () => {
  assert.equal(parseView([]), "top");
  assert.equal(parseView(["--view", "top"]), "top");
  assert.equal(parseView(["--view", "bottom"]), "bottom");
  assert.throws(() => parseView(["--view", "side"]), /top.*bottom/);
});

test("formats numeric coordinates like spreadsheet cells", () => {
  assert.equal(coordLabel(1, 1), "A1");
  assert.equal(coordLabel(2, 1), "B1");
  assert.equal(coordLabel(26, 1), "Z1");
  assert.equal(coordLabel(27, 1), "AA1");
  assert.equal(coordLabel(30, 30), "AD30");
});

test("parses spreadsheet coordinate labels", () => {
  assert.deepEqual(parseCoordLabel("A1"), { x: 1, y: 1 });
  assert.deepEqual(parseCoordLabel("B1"), { x: 2, y: 1 });
  assert.deepEqual(parseCoordLabel("Z1"), { x: 26, y: 1 });
  assert.deepEqual(parseCoordLabel("AA1"), { x: 27, y: 1 });
  assert.deepEqual(parseCoordLabel("L8"), { x: 12, y: 8 });
  assert.deepEqual(parseCoordLabel("AD30"), { x: 30, y: 30 });
});

test("rejects invalid spreadsheet coordinate labels", () => {
  for (const label of ["", "12L", "A0", "A-1", "AA", "1A"]) {
    assert.throws(() => parseCoordLabel(label), /Invalid coordinate label/);
  }
});

test("normalizes numeric and string part placements", () => {
  const numeric = normalizePlan(plan);
  assert.deepEqual(numeric.parts[0]?.at, { x: 2, y: 2 });

  const raw: RawPlan = {
    ...plan,
    parts: [{ ...plan.parts[0]!, at: "L8" }],
  };
  const normalized = normalizePlan(raw);
  assert.deepEqual(normalized.parts[0]?.at, { x: 12, y: 8 });
});

test("mirrors part and pin coordinates for bottom view", () => {
  const asymmetricPlan: Plan = {
    ...plan,
    board: { w: 8, h: 4 },
  };

  const bottomPlan = transformPlan(asymmetricPlan, "bottom");
  const part = bottomPlan.parts[0];
  assert.ok(part);
  assert.deepEqual(part.at, { x: 5, y: 2 });
  assert.deepEqual(part.pins.LEFT, { x: 3, y: 1 });
  assert.deepEqual(part.pins.RIGHT, { x: 1, y: 2 });

  const svg = renderPlan(bottomPlan, "bottom");
  assert.match(svg, /Pinplan - Bottom \/ Solder View/);
  assert.match(svg, /Mirrored for solder-side wiring\./);
  assert.match(svg, /data-pin="LEFT" cx="220" cy="112"/);
  assert.match(svg, /data-pin="RIGHT" cx="172" cy="136"/);
});

test("connects pins on one-dimensional component footprints", () => {
  const narrowPlan: Plan = {
    board: { w: 5, h: 5 },
    parts: [
      {
        id: "vertical",
        name: "Vertical header",
        at: { x: 2, y: 1 },
        size: { w: 1, h: 4 },
        pins: { A: { x: 1, y: 1 }, B: { x: 1, y: 4 } },
      },
      {
        id: "horizontal",
        name: "Horizontal header",
        at: { x: 1, y: 5 },
        size: { w: 3, h: 1 },
        pins: { A: { x: 1, y: 1 }, B: { x: 3, y: 1 } },
      },
    ],
  };

  const svg = renderPlan(narrowPlan);
  assert.match(svg, /<line class="part-outline" x1="100" y1="88" x2="100" y2="160"/);
  assert.match(svg, /<line class="part-outline" x1="76" y1="184" x2="124" y2="184"/);
});
