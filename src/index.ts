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
const padding = 32;

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function includePoint(bounds: Bounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function includeCircle(bounds: Bounds, cx: number, cy: number, radius: number): void {
  includePoint(bounds, cx - radius, cy - radius);
  includePoint(bounds, cx + radius, cy + radius);
}

function includeRect(bounds: Bounds, x: number, y: number, width: number, height: number, strokeWidth = 0): void {
  const halfStroke = strokeWidth / 2;
  includePoint(bounds, x - halfStroke, y - halfStroke);
  includePoint(bounds, x + width + halfStroke, y + height + halfStroke);
}

function includeLine(bounds: Bounds, x1: number, y1: number, x2: number, y2: number, strokeWidth: number): void {
  const halfStroke = strokeWidth / 2;
  includePoint(bounds, Math.min(x1, x2) - halfStroke, Math.min(y1, y2) - halfStroke);
  includePoint(bounds, Math.max(x1, x2) + halfStroke, Math.max(y1, y2) + halfStroke);
}

function includeText(
  bounds: Bounds,
  x: number,
  y: number,
  width: number,
  height: number,
  anchor: "start" | "middle" | "end",
): void {
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  includePoint(bounds, left, y - height);
  includePoint(bounds, left + width, y + 2);
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

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

function gridPosition(coordinate: number): number {
  return (coordinate - 1) * spacing;
}

export function renderPlan(plan: Plan, view: View = "top"): string {
  validatePlan(plan);

  const boardWidth = (plan.board.w - 1) * spacing;
  const boardHeight = (plan.board.h - 1) * spacing;
  const boardCenterX = boardWidth / 2;
  const elements: string[] = [];
  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  const title = view === "top" ? "Pinplan - Top View" : "Pinplan - Bottom / Solder View";
  const titleY = -36;
  elements.push(`<text x="${boardCenterX}" y="${titleY}" class="view-title" text-anchor="middle">${title}</text>`);
  includeText(bounds, boardCenterX, titleY, title.length * 9, 20, "middle");
  if (view === "bottom") {
    const note = "Mirrored for solder-side wiring.";
    const noteY = boardHeight + 24;
    elements.push(`<text x="${boardCenterX}" y="${noteY}" class="view-note" text-anchor="middle">${note}</text>`);
    includeText(bounds, boardCenterX, noteY, note.length * 7, 14, "middle");
  }

  for (let x = 1; x <= plan.board.w; x += 1) {
    const boardX = view === "bottom" ? plan.board.w - x + 1 : x;
    const columnLabel = coordLabel(boardX, 1).slice(0, -1);
    const labelX = gridPosition(x);
    elements.push(`<text x="${labelX}" y="-12" class="coordinate" text-anchor="middle">${columnLabel}</text>`);
    includeText(bounds, labelX, -12, columnLabel.length * 7, 14, "middle");
  }
  for (let y = 1; y <= plan.board.h; y += 1) {
    const label = String(y);
    const labelY = gridPosition(y) + 4;
    elements.push(`<text x="-14" y="${labelY}" class="coordinate" text-anchor="end">${label}</text>`);
    includeText(bounds, -14, labelY, label.length * 7, 14, "end");
  }
  for (let y = 1; y <= plan.board.h; y += 1) {
    for (let x = 1; x <= plan.board.w; x += 1) {
      const cx = gridPosition(x);
      const cy = gridPosition(y);
      elements.push(`<circle class="board-hole" cx="${cx}" cy="${cy}" r="2.25" fill="#484d55"/>`);
      includeCircle(bounds, cx, cy, 2.25);
    }
  }

  for (const part of plan.parts) {
    const left = gridPosition(part.at.x);
    const top = gridPosition(part.at.y);
    const partWidth = (part.size.w - 1) * spacing;
    const partHeight = (part.size.h - 1) * spacing;
    elements.push(`<g data-part="${escapeXml(part.id)}">`);
    if (part.size.w === 1 && part.size.h > 1) {
      elements.push(`<line class="part-outline" x1="${left}" y1="${top}" x2="${left}" y2="${top + partHeight}" stroke="#d6bd63" stroke-width="2"/>`);
      includeLine(bounds, left, top, left, top + partHeight, 2);
    } else if (part.size.h === 1 && part.size.w > 1) {
      elements.push(`<line class="part-outline" x1="${left}" y1="${top}" x2="${left + partWidth}" y2="${top}" stroke="#d6bd63" stroke-width="2"/>`);
      includeLine(bounds, left, top, left + partWidth, top, 2);
    } else if (part.size.w > 1 && part.size.h > 1) {
      elements.push(`<rect x="${left}" y="${top}" width="${partWidth}" height="${partHeight}" fill="none" stroke="#d6bd63" stroke-width="2"/>`);
      includeRect(bounds, left, top, partWidth, partHeight, 2);
    }
    const nameX = left + partWidth / 2;
    const nameY = top - 12;
    elements.push(`<text x="${nameX}" y="${nameY}" class="part-name" text-anchor="middle">${escapeXml(part.name)}</text>`);
    includeText(bounds, nameX, nameY, part.name.length * 8, 16, "middle");

    for (const [name, pin] of Object.entries(part.pins)) {
      const actualX = part.at.x + pin.x - 1;
      const actualY = part.at.y + pin.y - 1;
      const cx = gridPosition(actualX);
      const cy = gridPosition(actualY);
      const onLeft = pin.x === 1;
      const labelX = cx + (onLeft ? -9 : 9);
      const anchor = onLeft ? "end" : "start";
      elements.push(`<circle data-pin="${escapeXml(name)}" cx="${cx}" cy="${cy}" r="5" fill="#d6bd63"/>`);
      elements.push(`<text x="${labelX}" y="${cy + 4}" class="pin-label" text-anchor="${anchor}">${escapeXml(name)}</text>`);
      includeCircle(bounds, cx, cy, 5);
      includeText(bounds, labelX, cy + 4, name.length * 7, 14, anchor);
    }
    elements.push("</g>");
  }

  const viewBoxX = bounds.minX - padding;
  const viewBoxY = bounds.minY - padding;
  const viewBoxWidth = bounds.maxX - bounds.minX + padding * 2;
  const viewBoxHeight = bounds.maxY - bounds.minY + padding * 2;
  const boxX = formatNumber(viewBoxX);
  const boxY = formatNumber(viewBoxY);
  const boxWidth = formatNumber(viewBoxWidth);
  const boxHeight = formatNumber(viewBoxHeight);
  const background = `<rect class="background" x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" fill="#181a1f"/>`;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${boxWidth}" height="${boxHeight}" viewBox="${boxX} ${boxY} ${boxWidth} ${boxHeight}">`,
    `<style>text { font-family: system-ui, sans-serif; } .view-title { font-size: 16px; font-weight: 600; fill: #fff; } .view-note { font-size: 11px; fill: #9da3aa; } .coordinate { font-size: 10px; fill: #9da3aa; } .part-name { font-size: 13px; font-weight: 600; fill: #fff; } .pin-label { font-size: 9px; fill: #fff; }</style>`,
    background,
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
