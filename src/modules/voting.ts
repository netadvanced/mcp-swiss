import { fetchText } from "../utils/http.js";

// ── Base URLs ─────────────────────────────────────────────────────────────────

/**
 * BFS publishes the federal vote results as three CSVs behind stable DAM asset
 * ids: the content is replaced in place after each vote, so the id does not
 * change. (The CKAN metadata for the dataset still says modified 2024-12-16
 * while the files carry results through 2026 — trust the file, not the
 * metadata.) Dataset: opendata.swiss/…/eidgenossische-abstimmungsresultate
 */
const BFS_ASSET = "https://dam-api.bfs.admin.ch/hub/api/dam/assets";
const NATIONAL_CSV_URL = `${BFS_ASSET}/33707795/master`;
const CANTON_CSV_URL = `${BFS_ASSET}/33707737/master`;
const META_CSV_URL = `${BFS_ASSET}/33707794/master`;

const DATA_URL =
  "https://opendata.swiss/en/dataset/eidgenossische-abstimmungsresultate";
const SOURCE = "Federal Statistical Office (BFS) — federal popular votes";

/** The per-canton file is ~10 MB; the default 30 s is not enough on a cold run. */
const CANTON_TIMEOUT_MS = 120_000;

export type Lang = "de" | "fr" | "it" | "rm" | "en";
const LANGS: Lang[] = ["de", "fr", "it", "rm", "en"];

// ── CSV parsing ───────────────────────────────────────────────────────────────

/**
 * Minimal RFC 4180 reader for the BFS exports: header names arrive quoted, and
 * canton names such as "Graubünden / Grigioni, GR" carry commas inside quotes.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // Strip a BOM; the BFS files are UTF-8 with one.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body_] = rows;
  if (!header) return [];

  return body_
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => {
      const record: Record<string, string> = {};
      header.forEach((name, i) => {
        record[name] = r[i] ?? "";
      });
      return record;
    });
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let nationalCache: Record<string, string>[] | null = null;
let cantonCache: Record<string, string>[] | null = null;
let metaCache: Record<string, string>[] | null = null;

/** Reset the module-level CSV caches. Tests must call this between cases. */
export function clearVotingCache(): void {
  nationalCache = null;
  cantonCache = null;
  metaCache = null;
}

async function loadNational(): Promise<Record<string, string>[]> {
  nationalCache ??= parseCsv(await fetchText(NATIONAL_CSV_URL));
  return nationalCache;
}

/** Only get_vote_details needs this, so it stays out of the common path. */
async function loadCanton(): Promise<Record<string, string>[]> {
  cantonCache ??= parseCsv(
    await fetchText(CANTON_CSV_URL, { timeoutMs: CANTON_TIMEOUT_MS }),
  );
  return cantonCache;
}

async function loadMeta(): Promise<Record<string, string>[]> {
  metaCache ??= parseCsv(await fetchText(META_CSV_URL));
  return metaCache;
}

// ── Row helpers ───────────────────────────────────────────────────────────────

/** Empty means "not reported" — 19th century votes have no popular counts. */
function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Fall back to German: `rm` and `en` titles are blank on many older votes. */
function title(row: Record<string, string>, lang: Lang): string {
  const chosen = row[`vorlage_titel_${lang}`]?.trim();
  return chosen || row.vorlage_titel_de?.trim() || "Unknown";
}

function asOf(rows: Record<string, string>[]): string | undefined {
  return rows[0]?.daten_stand?.slice(0, 10) || undefined;
}

interface NationalVote {
  id: number;
  title: string;
  date: string;
  accepted: boolean;
  turnout: number | null;
  yes_count: number | null;
  no_count: number | null;
  yes_percent: number | null;
  eligible_voters: number | null;
  cantons_yes: number | null;
  cantons_no: number | null;
  /** null when no cantonal majority was required (ordinary law changes). */
  cantonal_majority: boolean | null;
}

function toNationalVote(row: Record<string, string>, lang: Lang): NationalVote {
  return {
    id: Number(row.vorlage_id),
    title: title(row, lang),
    date: row.urnengang_datum ?? "",
    accepted: row.vorlage_angenommen === "1",
    turnout: round(num(row.stimmbeteiligung)),
    yes_count: num(row.stimmen_ja),
    no_count: num(row.stimmen_nein),
    yes_percent: round(num(row.ja_prozent)),
    eligible_voters: num(row.stimmberechtigte),
    cantons_yes: num(row.staende_ja),
    cantons_no: num(row.staende_nein),
    cantonal_majority:
      row.staendemehr === "" || row.staendemehr === undefined
        ? null
        : row.staendemehr === "1",
  };
}

/** True when the keyword appears in any official-language title. */
function matchesTitle(row: Record<string, string>, needle: string): boolean {
  return LANGS.some((l) =>
    (row[`vorlage_titel_${l}`] ?? "").toLowerCase().includes(needle),
  );
}

function normaliseLang(value: unknown): Lang {
  return LANGS.includes(value as Lang) ? (value as Lang) : "de";
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const LANG_PARAM = {
  type: "string",
  enum: LANGS,
  default: "de",
  description: "Title language",
};

export const votingTools = [
  {
    name: "get_voting_results",
    description:
      "Federal popular vote results since 1848: turnout, yes/no counts, cantonal majority",
    inputSchema: {
      type: "object",
      properties: {
        year: {
          type: "number",
          description: "e.g. 2024 (omit for most recent)",
        },
        limit: {
          type: "number",
          description: "max 50",
          default: 10,
        },
        lang: LANG_PARAM,
      },
    },
  },
  {
    name: "search_votes",
    description:
      "Search federal votes by title keyword, in any official language",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Title keyword, e.g. CO2, AHV",
        },
        limit: {
          type: "number",
          description: "max 20",
          default: 5,
        },
        lang: LANG_PARAM,
      },
    },
  },
  {
    name: "get_vote_details",
    description:
      "One federal vote in detail: national totals, type, theme, per-canton breakdown. Give vote_title and/or date",
    inputSchema: {
      type: "object",
      properties: {
        vote_title: {
          type: "string",
          description: "Partial title, e.g. CO2-Gesetz",
        },
        date: {
          type: "string",
          description: "YYYY-MM-DD",
        },
        lang: LANG_PARAM,
      },
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function handleGetVotingResults(params: {
  year?: number;
  limit?: number;
  lang?: string;
}): Promise<string> {
  const limit = Math.min(params.limit ?? 10, 50);
  const lang = normaliseLang(params.lang);
  const rows = await loadNational();

  const matching = params.year
    ? rows.filter((r) => r.urnengang_datum?.startsWith(String(params.year)))
    : rows;

  const votes = matching
    .map((r) => toNationalVote(r, lang))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);

  if (votes.length === 0) {
    return JSON.stringify({
      count: 0,
      votes: [],
      hint: "No federal vote that year. Federal votes run since 1848; omit year for the most recent.",
      source: SOURCE,
      data_url: DATA_URL,
    });
  }

  const result = {
    count: votes.length,
    source: SOURCE,
    data_url: DATA_URL,
    as_of: asOf(rows),
    votes,
  };

  const json = JSON.stringify(result);
  if (json.length > 48000) {
    return JSON.stringify({ ...result, votes: votes.slice(0, 5) });
  }
  return json;
}

export async function handleSearchVotes(params: {
  query: string;
  limit?: number;
  lang?: string;
}): Promise<string> {
  if (!params.query?.trim()) {
    throw new Error("query is required: a keyword from the vote title, in any official language.");
  }

  const limit = Math.min(params.limit ?? 5, 20);
  const lang = normaliseLang(params.lang);
  const keyword = params.query.trim();
  const needle = keyword.toLowerCase();

  const rows = await loadNational();
  const votes = rows
    .filter((r) => matchesTitle(r, needle))
    .map((r) => toNationalVote(r, lang))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);

  if (votes.length === 0) {
    return JSON.stringify({
      query: keyword,
      count: 0,
      votes: [],
      hint: "Try a shorter keyword. Titles are the official wording in German, French, Italian, Romansh and English.",
    });
  }

  return JSON.stringify({
    query: keyword,
    count: votes.length,
    source: SOURCE,
    data_url: DATA_URL,
    as_of: asOf(rows),
    votes,
  });
}

export async function handleGetVoteDetails(params: {
  vote_title?: string;
  date?: string;
  lang?: string;
}): Promise<string> {
  if (!params.vote_title && !params.date) {
    throw new Error("Provide vote_title or date (YYYY-MM-DD). Use search_votes to find either.");
  }

  const lang = normaliseLang(params.lang);
  const rows = await loadNational();
  const needle = params.vote_title?.trim().toLowerCase();
  const date = params.date?.trim();

  const matched = rows.filter(
    (r) =>
      (!needle || matchesTitle(r, needle)) &&
      (!date || r.urnengang_datum === date),
  );

  if (matched.length === 0) {
    throw new Error(
      "No federal vote matches those parameters. Use search_votes for an exact title, or pass a date as YYYY-MM-DD.",
    );
  }

  // Several votes share a polling day, so narrowing is the caller's to do.
  if (matched.length > 1) {
    return JSON.stringify({
      matches: matched.map((r) => ({
        id: Number(r.vorlage_id),
        title: title(r, lang),
        date: r.urnengang_datum,
      })),
      hint: "Several votes match. Repeat with a vote_title distinctive enough to pick one.",
      source: SOURCE,
    });
  }

  const row = matched[0];
  const id = row.vorlage_id;
  const [meta, cantonRows] = await Promise.all([loadMeta(), loadCanton()]);

  const metaRow = meta.find((m) => m.vorlage_id === id);
  const themes = [1, 2, 3]
    .map((n) => metaRow?.[`thema${n}_name_${lang}`] || metaRow?.[`thema${n}_name_de`])
    .filter((t): t is string => Boolean(t && t.trim()));

  const cantons = cantonRows
    .filter((c) => c.vorlage_id === id)
    .sort((a, b) => Number(a.kanton_nummer) - Number(b.kanton_nummer))
    .map((c) => ({
      canton: c.kanton_bezeichnung,
      eligible_voters: num(c.stimmberechtigte),
      yes_count: num(c.stimmen_ja),
      no_count: num(c.stimmen_nein),
      yes_percent: round(num(c.ja_prozent)),
      turnout: round(num(c.stimmbeteiligung)),
    }));

  const detail: Record<string, unknown> = {
    id: Number(id),
    title: title(row, lang),
    date: row.urnengang_datum,
    type: metaRow?.[`typ_bfs_name_${lang}`] || metaRow?.typ_bfs_name_de,
    themes,
    national: toNationalVote(row, lang),
    cantons,
    source: SOURCE,
    data_url: DATA_URL,
    as_of: asOf(rows),
  };

  if (cantons.length === 0) {
    detail.note =
      "No per-canton figures for this vote — the BFS canton series starts in 1866.";
  }

  return JSON.stringify(detail);
}

// ── Adapter export for index.ts integration ───────────────────────────────────

export async function handleVoting(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "get_voting_results":
      return handleGetVotingResults(args as { year?: number; limit?: number; lang?: string });
    case "search_votes":
      return handleSearchVotes(args as { query: string; limit?: number; lang?: string });
    case "get_vote_details":
      return handleGetVoteDetails(args as { vote_title?: string; date?: string; lang?: string });
    default:
      throw new Error(`Unknown voting tool: ${name}`);
  }
}
