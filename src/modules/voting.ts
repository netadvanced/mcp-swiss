import { fetchText } from "../utils/http.js";
import { cached } from "../utils/cache.js";

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

  // Strip a BOM; the BFS files are UTF-8 with one.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const n = body.length;
  let i = 0;

  // Fields are cut out with slice(): appending char by char builds a rope per
  // field, which held ~240 MB for the 10 MB canton file.
  while (i < n) {
    let field: string;

    if (body[i] === '"') {
      i++;
      field = "";
      for (;;) {
        const q = body.indexOf('"', i);
        if (q === -1) {
          field += body.slice(i);
          i = n;
          break;
        }
        field += body.slice(i, q);
        i = q + 1;
        if (body[i] === '"') {
          field += '"';
          i++;
        } else {
          break;
        }
      }
    } else {
      const start = i;
      while (i < n && body[i] !== "," && body[i] !== "\n") i++;
      field = body.slice(start, i);
      if (field.endsWith("\r")) field = field.slice(0, -1);
    }

    row.push(field);
    if (i >= n || body[i] === "\n") {
      rows.push(row);
      row = [];
    } else if (body[i] === "\r" && body[i + 1] === "\n") {
      i++;
      rows.push(row);
      row = [];
    }
    i++;
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

type Row = Record<string, string>;

/** BFS replaces the files after each vote (about four times a year). */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** A 200 with an HTML error page or an empty body must not read as "no votes". */
function load(url: string, timeoutMs?: number): () => Promise<Row[]> {
  return async () => {
    const rows = parseCsv(await fetchText(url, timeoutMs ? { timeoutMs } : undefined));
    if (rows.length === 0 || !("vorlage_id" in rows[0])) {
      throw new Error(`Unexpected format from the BFS export — ${url}`);
    }
    return rows;
  };
}

const national = cached(CACHE_TTL_MS, load(NATIONAL_CSV_URL));
/** Only get_vote_details needs this, so it stays out of the common path. */
const canton = cached(CACHE_TTL_MS, load(CANTON_CSV_URL, CANTON_TIMEOUT_MS));
const meta = cached(CACHE_TTL_MS, load(META_CSV_URL));

/** Reset the module-level CSV caches. Tests must call this between cases. */
export function clearVotingCache(): void {
  national.clear();
  canton.clear();
  meta.clear();
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
function title(row: Row, lang: Lang): string {
  const chosen = row[`vorlage_titel_${lang}`]?.trim();
  return chosen || row.vorlage_titel_de?.trim() || "Unknown";
}

function asOf(rows: Row[]): string | undefined {
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
  /** Present only while BFS still flags the result as provisional. */
  provisional?: true;
}

function toNationalVote(row: Row, lang: Lang): NationalVote {
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
    ...(row.provisorisch === "1" ? { provisional: true as const } : {}),
  };
}

/** True when the keyword appears in any official-language title. */
function matchesTitle(row: Row, needle: string): boolean {
  return LANGS.some((l) =>
    (row[`vorlage_titel_${l}`] ?? "").toLowerCase().includes(needle),
  );
}

function normaliseLang(value: unknown): Lang {
  return LANGS.includes(value as Lang) ? (value as Lang) : "de";
}

/** A zero or negative limit must not reach slice(), where -1 means "all but one". */
function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value ?? fallback));
  return Number.isFinite(n) ? Math.max(1, Math.min(n, max)) : fallback;
}

/** The newest vote first, which is what every list here promises. */
function byDateDesc(a: { date: string }, b: { date: string }): number {
  return b.date.localeCompare(a.date);
}

const MAX_QUERY_LENGTH = 200;
const MAX_MATCHES = 20;

/**
 * BFS lists some cantons twice for votes between 1960 and 1981 (the rows differ
 * only in a detail such as the electorate). Keep one row per canton: the
 * variant, first or last, whose yes/no counts add up to the national result.
 */
function onePerCanton(rows: Row[], vote: Row): { rows: Row[]; reconciled: boolean } {
  const first = new Map<string, Row>();
  const last = new Map<string, Row>();
  for (const r of rows) {
    if (!first.has(r.kanton_nummer)) first.set(r.kanton_nummer, r);
    last.set(r.kanton_nummer, r);
  }
  if (first.size === rows.length) return { rows, reconciled: true };

  const sum = (m: Map<string, Row>, col: string) =>
    [...m.values()].reduce((t, r) => t + (num(r[col]) ?? 0), 0);
  const adds = (m: Map<string, Row>) =>
    sum(m, "stimmen_ja") === num(vote.stimmen_ja) &&
    sum(m, "stimmen_nein") === num(vote.stimmen_nein);

  if (adds(first)) return { rows: [...first.values()], reconciled: true };
  return { rows: [...last.values()], reconciled: adds(last) };
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
      "One federal vote in detail: national totals, type, theme, per-canton breakdown. Give id, or vote_title and/or date",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "Vote id from search_votes",
        },
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
  const limit = clampLimit(params.limit, 10, 50);
  const lang = normaliseLang(params.lang);
  const rows = await national.get();

  const matching = params.year
    ? rows.filter((r) => r.urnengang_datum?.startsWith(String(params.year)))
    : rows;

  const votes = matching
    .map((r) => toNationalVote(r, lang))
    .sort(byDateDesc)
    .slice(0, limit);

  if (votes.length === 0) {
    return JSON.stringify({
      count: 0,
      votes: [],
      hint: "No federal vote that year. Federal votes run since 1848; omit year for the most recent.",
      source: SOURCE,
      data_url: DATA_URL,
      as_of: asOf(rows),
    });
  }

  return JSON.stringify({
    count: votes.length,
    source: SOURCE,
    data_url: DATA_URL,
    as_of: asOf(rows),
    votes,
  });
}

export async function handleSearchVotes(params: {
  query: string;
  limit?: number;
  lang?: string;
}): Promise<string> {
  const keyword = params.query?.trim();
  if (!keyword) {
    throw new Error("query is required: a keyword from the vote title, in any official language.");
  }
  if (keyword.length > MAX_QUERY_LENGTH) {
    throw new Error(`query is too long (max ${MAX_QUERY_LENGTH} characters). Use a keyword.`);
  }

  const limit = clampLimit(params.limit, 5, 20);
  const lang = normaliseLang(params.lang);
  const needle = keyword.toLowerCase();

  const rows = await national.get();
  const votes = rows
    .filter((r) => matchesTitle(r, needle))
    .map((r) => toNationalVote(r, lang))
    .sort(byDateDesc)
    .slice(0, limit);

  if (votes.length === 0) {
    return JSON.stringify({
      query: keyword,
      count: 0,
      votes: [],
      hint: "Try a shorter keyword. Titles are the official wording in German, French, Italian, Romansh and English.",
      source: SOURCE,
      data_url: DATA_URL,
      as_of: asOf(rows),
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
  id?: number;
  vote_title?: string;
  date?: string;
  lang?: string;
}): Promise<string> {
  const needle = params.vote_title?.trim().toLowerCase();
  const date = params.date?.trim();
  const wantedId = params.id === undefined ? undefined : String(params.id);
  if (!needle && !date && wantedId === undefined) {
    throw new Error("Provide id, vote_title or date (YYYY-MM-DD). Use search_votes to find them.");
  }
  if (needle && needle.length > MAX_QUERY_LENGTH) {
    throw new Error(`vote_title is too long (max ${MAX_QUERY_LENGTH} characters).`);
  }

  const lang = normaliseLang(params.lang);
  const rows = await national.get();

  const matched = rows.filter(
    (r) =>
      (wantedId === undefined || r.vorlage_id === wantedId) &&
      (!needle || matchesTitle(r, needle)) &&
      (!date || r.urnengang_datum === date),
  );

  if (matched.length === 0) {
    throw new Error(
      "No federal vote matches those parameters. Use search_votes for an exact title or id, or pass a date as YYYY-MM-DD.",
    );
  }

  // Several votes can match (a busy polling day, a broad keyword), so narrowing
  // is the caller's to do.
  if (matched.length > 1) {
    const listed = matched
      .map((r) => ({ id: Number(r.vorlage_id), title: title(r, lang), date: r.urnengang_datum }))
      .sort(byDateDesc)
      .slice(0, MAX_MATCHES);
    return JSON.stringify({
      total_matches: matched.length,
      matches: listed,
      hint: "Several votes match. Repeat with the id of one, or a more distinctive vote_title.",
      source: SOURCE,
      as_of: asOf(rows),
    });
  }

  const row = matched[0];
  const id = row.vorlage_id;
  const [metaRows, cantonRows] = await Promise.all([meta.get(), canton.get()]);

  const metaRow = metaRows.find((m) => m.vorlage_id === id);
  const themes = [1, 2, 3]
    .map((n) => metaRow?.[`thema${n}_name_${lang}`] || metaRow?.[`thema${n}_name_de`])
    .filter((t): t is string => Boolean(t && t.trim()));

  const { rows: perCanton, reconciled } = onePerCanton(
    cantonRows.filter((c) => c.vorlage_id === id),
    row,
  );
  const cantons = perCanton
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
  } else if (!reconciled) {
    detail.note =
      "The BFS canton rows for this vote do not add up to the national totals; trust `national`.";
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
      return handleGetVoteDetails(args as { id?: number; vote_title?: string; date?: string; lang?: string });
    default:
      throw new Error(`Unknown voting tool: ${name}`);
  }
}
