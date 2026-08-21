import assert from "node:assert/strict";
import test from "node:test";

import { renderPlan, validatePlan, type Plan } from "../src/index.js";

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
  assert.match(svg, /<svg/);
  assert.match(svg, /Example &lt;part&gt;/);
  assert.match(svg, /data-pin="LEFT" cx="96" cy="96"/);
  assert.match(svg, /data-pin="RIGHT" cx="144" cy="120"/);
  assert.match(svg, /<rect width="100%" height="100%" fill="#181a1f"\/>/);
  assert.match(svg, /class="board-hole"[^>]+fill="#484d55"/);
  assert.match(svg, /\.part-name[^}]+fill: #fff/);
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
