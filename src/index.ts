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

export type RawPart = Omit<Part, "at"> & {
  at: Part["at"] | string;
};

export type RawPlan = {
  board: Board;
  parts: RawPart[];
};

export type View = "top" | "bottom";

const spacing = 24;
const padding = 40;
const titleHeight = 24;
const columnLabelArea = 24;
const rowLabelArea = 36;
const viewNoteHeight = 24;

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function coordLabel(x: number, y: number): string {
  if (!isPositiveInteger(x) || !isPositiveInteger(y)) {
    throw new Error("Coordinates must be positive whole numbers.");
  }

  let column = "";
  let remaining = x;
  while (remaining > 0) {
    remaining -= 1;
    column = String.fromCharCode(65 + (remaining % 26)) + column;
    remaining = Math.floor(remaining / 26);
  }
  return `${column}${y}`;
}

export function parseCoordLabel(label: string): { x: number; y: number } {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(label);
  if (!match) {
    throw new Error(`Invalid coordinate label "${label}". Expected a label such as A1 or AD30.`);
  }

  const letters = match[1]!;
  let x = 0;
  for (const letter of letters) {
    x = x * 26 + letter.charCodeAt(0) - 64;
  }
  const y = Number(match[2]);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new Error(`Invalid coordinate label "${label}". Coordinate is too large.`);
  }
  return { x, y };
}

export function normalizePlan(rawPlan: RawPlan): Plan {
  if (!rawPlan || !rawPlan.board || !Array.isArray(rawPlan.parts)) {
    throw new Error("Plan must contain a board and a parts array.");
  }

  return {
    board: { ...rawPlan.board },
    parts: rawPlan.parts.map((part) => ({
      ...part,
      at: typeof part.at === "string" ? parseCoordLabel(part.at) : { ...part.at },
      size: { ...part.size },
      pins: Object.fromEntries(
        Object.entries(part.pins).map(([name, pin]) => [name, { ...pin }]),
      ),
    })),
  };
}

export function parseView(args: string[]): View {
  if (args.length === 0) {
    return "top";
  }
  if (args.length !== 2 || args[0] !== "--view") {
    throw new Error('Usage: npm run draw -- --view <top|bottom>.');
  }

  const view = args[1];
  if (view !== "top" && view !== "bottom") {
    throw new Error(`Invalid --view value "${view}". Expected "top" or "bottom".`);
  }
  return view;
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

export function transformPlan(plan: Plan, view: View): Plan {
  validatePlan(plan);
  if (view === "top") {
    return plan;
  }

  return {
    board: { ...plan.board },
    parts: plan.parts.map((part) => {
      const topRight = part.at.x + part.size.w - 1;
      return {
        ...part,
        at: {
          x: plan.board.w - topRight + 1,
          y: part.at.y,
        },
        size: { ...part.size },
        pins: Object.fromEntries(
          Object.entries(part.pins).map(([name, pin]) => [
            name,
            { x: part.size.w - pin.x + 1, y: pin.y },
          ]),
        ),
      };
    }),
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function gridPosition(origin: number, coordinate: number): number {
  return origin + (coordinate - 1) * spacing;
}

export function renderPlan(plan: Plan, view: View = "top"): string {
  validatePlan(plan);

  const boardWidth = (plan.board.w - 1) * spacing;
  const boardHeight = (plan.board.h - 1) * spacing;
  const noteHeight = view === "bottom" ? viewNoteHeight : 0;
  const boardLeft = padding + rowLabelArea;
  const boardTop = padding + titleHeight + columnLabelArea;
  const width = padding + rowLabelArea + boardWidth + padding;
  const height = padding + titleHeight + columnLabelArea + boardHeight + noteHeight + padding;
  const boardCenterX = boardLeft + boardWidth / 2;
  const elements: string[] = [];

  elements.push(`<rect width="100%" height="100%" fill="#181a1f"/>`);
  const title = view === "top" ? "Pinplan - Top View" : "Pinplan - Bottom / Solder View";
  elements.push(`<text x="${boardCenterX}" y="${padding + 16}" class="view-title" text-anchor="middle">${title}</text>`);
  if (view === "bottom") {
    elements.push(`<text x="${boardCenterX}" y="${boardTop + boardHeight + 18}" class="view-note" text-anchor="middle">Mirrored for solder-side wiring.</text>`);
  }

  for (let x = 1; x <= plan.board.w; x += 1) {
    const boardX = view === "bottom" ? plan.board.w - x + 1 : x;
    const columnLabel = coordLabel(boardX, 1).slice(0, -1);
    elements.push(`<text x="${gridPosition(boardLeft, x)}" y="${boardTop - 12}" class="coordinate" text-anchor="middle">${columnLabel}</text>`);
  }
  for (let y = 1; y <= plan.board.h; y += 1) {
    elements.push(`<text x="${boardLeft - 14}" y="${gridPosition(boardTop, y) + 4}" class="coordinate" text-anchor="end">${y}</text>`);
  }
  for (let y = 1; y <= plan.board.h; y += 1) {
    for (let x = 1; x <= plan.board.w; x += 1) {
      elements.push(`<circle class="board-hole" cx="${gridPosition(boardLeft, x)}" cy="${gridPosition(boardTop, y)}" r="2.25" fill="#484d55"/>`);
    }
  }

  for (const part of plan.parts) {
    const left = gridPosition(boardLeft, part.at.x);
    const top = gridPosition(boardTop, part.at.y);
    const partWidth = (part.size.w - 1) * spacing;
    const partHeight = (part.size.h - 1) * spacing;
    elements.push(`<g data-part="${escapeXml(part.id)}">`);
    elements.push(`<rect x="${left}" y="${top}" width="${partWidth}" height="${partHeight}" fill="none" stroke="#d6bd63" stroke-width="2"/>`);
    elements.push(`<text x="${left + partWidth / 2}" y="${top - 12}" class="part-name" text-anchor="middle">${escapeXml(part.name)}</text>`);

    for (const [name, pin] of Object.entries(part.pins)) {
      const actualX = part.at.x + pin.x - 1;
      const actualY = part.at.y + pin.y - 1;
      const cx = gridPosition(boardLeft, actualX);
      const cy = gridPosition(boardTop, actualY);
      const onLeft = pin.x === 1;
      const labelX = cx + (onLeft ? -9 : 9);
      const anchor = onLeft ? "end" : "start";
      elements.push(`<circle data-pin="${escapeXml(name)}" cx="${cx}" cy="${cy}" r="5" fill="#d6bd63"/>`);
      elements.push(`<text x="${labelX}" y="${cy + 4}" class="pin-label" text-anchor="${anchor}">${escapeXml(name)}</text>`);
    }
    elements.push("</g>");
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<style>text { font-family: system-ui, sans-serif; } .view-title { font-size: 16px; font-weight: 600; fill: #fff; } .view-note { font-size: 11px; fill: #9da3aa; } .coordinate { font-size: 10px; fill: #9da3aa; } .part-name { font-size: 13px; font-weight: 600; fill: #fff; } .pin-label { font-size: 9px; fill: #fff; }</style>`,
    ...elements,
    `</svg>`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const view = parseView(process.argv.slice(2));
  const planText = await readFile("plan.json", "utf8");
  const rawPlan = JSON.parse(planText) as RawPlan;
  const plan = normalizePlan(rawPlan);
  const transformedPlan = transformPlan(plan, view);
  const svg = renderPlan(transformedPlan, view);
  await writeFile("output.svg", svg, "utf8");
  console.log(`Generated output.svg (${view} view)`);
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
