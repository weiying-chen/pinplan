import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type Board = {
  w: number;
  h: number;
};

export type Pin = {
  x: number;
  y: number;
};

export type Part = {
  id: string;
  name: string;
  at: { x: number; y: number };
  size: { w: number; h: number };
  pins: Record<string, Pin>;
};

export type Plan = {
  board: Board;
  parts: Part[];
};

const spacing = 24;
const margin = 72;

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function validatePlan(plan: Plan): void {
  if (!plan || !plan.board || !Array.isArray(plan.parts)) {
    throw new Error("Plan must contain a board and a parts array.");
  }

  if (!isPositiveNumber(plan.board.w) || !isPositiveNumber(plan.board.h)) {
    throw new Error("board.w and board.h must be positive numbers.");
  }
  if (!isPositiveInteger(plan.board.w) || !isPositiveInteger(plan.board.h)) {
    throw new Error("board.w and board.h must be whole numbers.");
  }

  for (const part of plan.parts) {
    const label = part.id || part.name || "unnamed part";
    if (!part.at || !isPositiveInteger(part.at.x) || !isPositiveInteger(part.at.y)) {
      throw new Error(`Part "${label}" at coordinates must be positive whole numbers inside the board.`);
    }
    if (part.at.x > plan.board.w || part.at.y > plan.board.h) {
      throw new Error(`Part "${label}" at coordinates must be inside the board.`);
    }
    if (!part.size || !isPositiveInteger(part.size.w) || !isPositiveInteger(part.size.h)) {
      throw new Error(`Part "${label}" size must contain positive whole numbers.`);
    }

    const right = part.at.x + part.size.w - 1;
    const bottom = part.at.y + part.size.h - 1;
    if (right > plan.board.w || bottom > plan.board.h) {
      throw new Error(`Part "${label}" must fit inside the board.`);
    }

    if (!part.pins || typeof part.pins !== "object") {
      throw new Error(`Part "${label}" pins must be an object.`);
    }
    for (const [name, pin] of Object.entries(part.pins)) {
      if (!isPositiveInteger(pin.x) || !isPositiveInteger(pin.y) || pin.x > part.size.w || pin.y > part.size.h) {
        throw new Error(`Pin "${name}" on part "${label}" must be inside the part size.`);
      }

      const actualX = part.at.x + pin.x - 1;
      const actualY = part.at.y + pin.y - 1;
      if (actualX < 1 || actualY < 1 || actualX > plan.board.w || actualY > plan.board.h) {
        throw new Error(`Pin "${name}" on part "${label}" must be inside the board.`);
      }
    }
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function boardPosition(coordinate: number): number {
  return margin + (coordinate - 1) * spacing;
}

export function renderPlan(plan: Plan): string {
  validatePlan(plan);

  const width = margin * 2 + (plan.board.w - 1) * spacing;
  const height = margin * 2 + (plan.board.h - 1) * spacing;
  const elements: string[] = [];

  elements.push(`<rect width="100%" height="100%" fill="#181a1f"/>`);

  for (let x = 1; x <= plan.board.w; x += 1) {
    elements.push(`<text x="${boardPosition(x)}" y="${margin - 26}" class="coordinate" text-anchor="middle">${x}</text>`);
  }
  for (let y = 1; y <= plan.board.h; y += 1) {
    elements.push(`<text x="${margin - 26}" y="${boardPosition(y) + 4}" class="coordinate" text-anchor="end">${y}</text>`);
  }
  for (let y = 1; y <= plan.board.h; y += 1) {
    for (let x = 1; x <= plan.board.w; x += 1) {
      elements.push(`<circle class="board-hole" cx="${boardPosition(x)}" cy="${boardPosition(y)}" r="2.25" fill="#484d55"/>`);
    }
  }

  for (const part of plan.parts) {
    const left = boardPosition(part.at.x);
    const top = boardPosition(part.at.y);
    const partWidth = (part.size.w - 1) * spacing;
    const partHeight = (part.size.h - 1) * spacing;
    elements.push(`<g data-part="${escapeXml(part.id)}">`);
    elements.push(`<rect x="${left}" y="${top}" width="${partWidth}" height="${partHeight}" fill="none" stroke="#8ab4d0" stroke-width="2"/>`);
    elements.push(`<text x="${left + partWidth / 2}" y="${top - 12}" class="part-name" text-anchor="middle">${escapeXml(part.name)}</text>`);

    for (const [name, pin] of Object.entries(part.pins)) {
      const actualX = part.at.x + pin.x - 1;
      const actualY = part.at.y + pin.y - 1;
      const cx = boardPosition(actualX);
      const cy = boardPosition(actualY);
      const onLeft = pin.x === 1;
      const labelX = cx + (onLeft ? -9 : 9);
      const anchor = onLeft ? "end" : "start";
      elements.push(`<circle data-pin="${escapeXml(name)}" cx="${cx}" cy="${cy}" r="5" fill="#252a30" stroke="#d8e7f0" stroke-width="1.5"/>`);
      elements.push(`<text x="${labelX}" y="${cy + 4}" class="pin-label" text-anchor="${anchor}">${escapeXml(name)}</text>`);
    }
    elements.push("</g>");
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<style>text { font-family: system-ui, sans-serif; } .coordinate { font-size: 10px; fill: #9da3aa; } .part-name { font-size: 13px; font-weight: 600; fill: #fff; } .pin-label { font-size: 9px; fill: #fff; }</style>`,
    ...elements,
    `</svg>`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const planText = await readFile("plan.json", "utf8");
  const plan = JSON.parse(planText) as Plan;
  const svg = renderPlan(plan);
  await writeFile("output.svg", svg, "utf8");
  console.log("Generated output.svg");
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
