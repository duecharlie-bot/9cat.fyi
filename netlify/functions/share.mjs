import { randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "draft-shares";
const ID_RE = /^[a-f0-9]{8}$/;
const ALLOWED_CATS = new Set(["FG%", "FT%", "3PM", "PTS", "REB", "AST", "STL", "BLK", "TO"]);

const jsonResponse = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  },
});

function finiteNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error("invalid number");
  return n;
}

function integer(value, min, max) {
  const n = finiteNumber(value, min, max);
  if (!Number.isInteger(n)) throw new Error("invalid integer");
  return n;
}

function shortText(value, max, allowEmpty = true) {
  const s = String(value ?? "").trim();
  if ((!allowEmpty && !s) || s.length > max) throw new Error("invalid text");
  return s;
}

function gradeFor(winRate) {
  if (winRate >= 100) return "S+";
  if (winRate >= 90) return "S";
  if (winRate >= 80) return "A+";
  if (winRate >= 70) return "A";
  if (winRate >= 60) return "B";
  if (winRate >= 50) return "C";
  if (winRate >= 40) return "D";
  return "F";
}

function categoryRank(value, teams) {
  if (!Array.isArray(value) || value.length < 2) throw new Error("invalid category rank");
  const label = shortText(value[0], 8, false);
  if (!ALLOWED_CATS.has(label)) throw new Error("invalid category");
  return [label, integer(value[1], 1, teams)];
}

function puntCategory(value) {
  const label = shortText(value, 8, false);
  if (!ALLOWED_CATS.has(label)) throw new Error("invalid punt");
  return label;
}

function rosterPlayer(value) {
  if (!Array.isArray(value) || value.length < 1) throw new Error("invalid player");
  return [
    shortText(value[0], 80, false),
    shortText(value[1], 8),
    shortText(value[2], 24),
  ];
}

// Store only the fields required by the public share page. The server
// re-validates and recomputes the grade so arbitrary JSON cannot be saved.
function sanitizeShare(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid payload");
  const teams = integer(input.tm, 2, 24);
  const rounds = integer(input.r, 1, 20);
  const winRate = Math.round(finiteNumber(input.wr, 0, 100) * 10) / 10;
  const wins = integer(input.w, 0, teams - 1);
  const losses = integer(input.l, 0, teams - 1);
  const ties = integer(input.t, 0, teams - 1);
  if (wins + losses + ties !== teams - 1) throw new Error("invalid field record");

  const roster = Array.isArray(input.ro) ? input.ro.map(rosterPlayer) : [];
  if (!roster.length || roster.length > rounds || roster.length > 20) throw new Error("invalid roster");

  const strong = Array.isArray(input.s) ? input.s.map(x => categoryRank(x, teams)) : [];
  const weak = Array.isArray(input.wk) ? input.wk.map(x => categoryRank(x, teams)) : [];
  const punts = Array.isArray(input.p) ? input.p.map(puntCategory) : [];
  if (strong.length > 3 || weak.length > 3 || punts.length > 9) throw new Error("too many categories");

  return {
    v: 2,
    g: gradeFor(winRate),
    wr: winRate,
    w: wins,
    l: losses,
    t: ties,
    tm: teams,
    r: rounds,
    s: strong,
    wk: weak,
    p: punts,
    ro: roster,
  };
}

async function createShare(request, store) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) return jsonResponse({ error: "Share payload is too large." }, 413);

  let raw;
  try { raw = await request.json(); }
  catch { return jsonResponse({ error: "Invalid JSON." }, 400); }

  let payload;
  try { payload = sanitizeShare(raw); }
  catch { return jsonResponse({ error: "Invalid draft share." }, 400); }

  const createdAt = new Date().toISOString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const id = randomBytes(4).toString("hex");
    const result = await store.setJSON(id, { ...payload, createdAt }, {
      onlyIfNew: true,
      metadata: { createdAt },
    });
    if (result?.modified) {
      const origin = new URL(request.url).origin;
      return jsonResponse({ id, url: `${origin}/s/${id}` }, 201, { "cache-control": "no-store" });
    }
  }
  return jsonResponse({ error: "Could not create a share link." }, 503);
}

async function getShare(request, store) {
  const id = (new URL(request.url).searchParams.get("id") || "").toLowerCase();
  if (!ID_RE.test(id)) return jsonResponse({ error: "Invalid share id." }, 400);

  const payload = await store.get(id, { type: "json" });
  if (!payload) return jsonResponse({ error: "Share not found." }, 404);
  return jsonResponse(payload, 200, {
    "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
  });
}

export default async (request) => {
  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    if (request.method === "POST") return await createShare(request, store);
    if (request.method === "GET") return await getShare(request, store);
    return jsonResponse({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
  } catch (error) {
    console.error("nineCat share function error", error);
    return jsonResponse({ error: "Share service unavailable." }, 500);
  }
};

export const config = {
  path: "/api/share",
  method: ["GET", "POST"],
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
