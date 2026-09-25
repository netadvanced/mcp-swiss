import { describe, it, expect, vi, afterEach } from "vitest";
import {
  handleGetVotingResults,
  handleSearchVotes,
  handleGetVoteDetails,
  votingTools,
  clearVotingCache,
  parseCsv,
} from "../../src/modules/voting.js";
import {
  NATIONAL_CSV,
  CANTON_CSV,
  META_CSV,
  EXPECTED_NATIONALSTRASSEN,
  EXPECTED_UNTERMIETE,
  EXPECTED_1848,
  EXPECTED_EWR,
} from "../fixtures/voting.js";

/**
 * Serve CSV text per upstream asset id. The module fetches three different
 * files, so a mock that ignores the URL would hide which one it asked for.
 */
function mockCsv(byAsset: Record<string, string>) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const asset = Object.keys(byAsset).find((id) => url.includes(id));
    if (!asset) {
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers(),
        text: () => Promise.resolve(""),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: () => Promise.resolve(byAsset[asset]),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const NATIONAL_ASSET = "33707795";
const CANTON_ASSET = "33707737";
const META_ASSET = "33707794";
const ALL_CSV = {
  [NATIONAL_ASSET]: NATIONAL_CSV,
  [CANTON_ASSET]: CANTON_CSV,
  [META_ASSET]: META_CSV,
};

afterEach(() => {
  vi.unstubAllGlobals();
  clearVotingCache();
});

describe("parseCsv", () => {
  it("strips the quotes BFS puts around header names", () => {
    const rows = parseCsv('"a","b"\n1,2');
    expect(Object.keys(rows[0])).toEqual(["a", "b"]);
  });

  it("keeps a comma that sits inside a quoted field", () => {
    const rows = parseCsv('"a","b"\n"Graubünden / Grigioni, GR",7');
    expect(rows[0].a).toBe("Graubünden / Grigioni, GR");
    expect(rows[0].b).toBe("7");
  });

  it("returns no rows for a header-only file", () => {
    expect(parseCsv('"a","b"')).toEqual([]);
  });
});

describe("votingTools definitions", () => {
  it("exports 3 tools", () => {
    expect(votingTools).toHaveLength(3);
  });

  it("keeps the existing tool names so callers do not break", () => {
    expect(votingTools.map((t) => t.name)).toEqual([
      "get_voting_results",
      "search_votes",
      "get_vote_details",
    ]);
  });

  it("no longer describes the data as Basel-Stadt", () => {
    const text = JSON.stringify(votingTools);
    expect(text).not.toMatch(/Basel/i);
  });

  it("offers lang on every tool, defaulting to German", () => {
    for (const tool of votingTools) {
      const lang = (tool.inputSchema.properties as Record<string, { enum?: string[]; default?: string }>)
        .lang;
      expect(lang?.enum).toEqual(["de", "fr", "it", "rm", "en"]);
      expect(lang?.default).toBe("de");
    }
  });
});

describe("handleGetVotingResults", () => {
  it("reports the national result, not one canton's count", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 2024 }));
    const vote = result.votes.find(
      (v: { id: number }) => v.id === EXPECTED_NATIONALSTRASSEN.id,
    );

    expect(vote.yes_percent).toBe(EXPECTED_NATIONALSTRASSEN.yes_percent);
    expect(vote.accepted).toBe(false);
    expect(vote.yes_count).toBe(1181560);
    expect(vote.no_count).toBe(1316505);
    expect(vote.eligible_voters).toBe(5615207);
  });

  it("reports turnout", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 2024 }));
    const vote = result.votes.find((v: { id: number }) => v.id === 6730);

    expect(vote.turnout).toBe(45.06);
  });

  it("reports the cantonal majority as counted, including half cantons", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 2024 }));
    const vote = result.votes.find(
      (v: { id: number }) => v.id === EXPECTED_UNTERMIETE.id,
    );

    expect(vote.cantons_yes).toBe(EXPECTED_UNTERMIETE.cantons_yes);
    expect(vote.cantons_no).toBe(EXPECTED_UNTERMIETE.cantons_no);
  });

  it("marks an accepted vote as accepted", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 2024 }));
    const vote = result.votes.find((v: { id: number }) => v.id === 6760);

    expect(vote.accepted).toBe(true);
  });

  it("returns null counts for a 19th century vote that has none", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 1848 }));
    const vote = result.votes.find((v: { id: number }) => v.id === EXPECTED_1848.id);

    expect(vote.date).toBe(EXPECTED_1848.date);
    expect(vote.yes_count).toBeNull();
    expect(vote.turnout).toBeNull();
    expect(vote.accepted).toBe(true);
    expect(vote.cantons_yes).toBe(EXPECTED_1848.cantons_yes);
  });

  it("filters by year", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 2024 }));

    expect(result.votes).toHaveLength(4);
    for (const vote of result.votes) {
      expect(vote.date.startsWith("2024")).toBe(true);
    }
  });

  it("honours limit", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ limit: 2 }));

    expect(result.votes).toHaveLength(2);
  });

  it("returns the most recent votes first when no year is given", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({}));
    const dates = result.votes.map((v: { date: string }) => v.date);

    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("passes through the upstream as_of so staleness is visible", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({}));

    expect(result.as_of).toBe("2026-06-14");
  });

  it("fetches the CSV once across calls, then serves from cache", async () => {
    const fetchMock = mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    await handleGetVotingResults({});
    await handleGetVotingResults({ year: 2024 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an empty year without throwing", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 1999 }));

    expect(result.count).toBe(0);
    expect(result.votes).toEqual([]);
    expect(result.hint).toBeTruthy();
  });

  it("returns the French title when lang is fr", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 2024, lang: "fr" }));
    const vote = result.votes.find((v: { id: number }) => v.id === 6730);

    expect(vote.title).toMatch(/routes nationales/i);
  });

  it("falls back to German when the requested language is empty upstream", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 1848, lang: "rm" }));
    const vote = result.votes.find((v: { id: number }) => v.id === 10);

    expect(vote.title).toBe("Totalrevision vom 12. September 1848");
  });
});

describe("handleSearchVotes", () => {
  it("finds a vote by a word from its German title", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleSearchVotes({ query: "Nationalstrassen" }));

    expect(result.votes.map((v: { id: number }) => v.id)).toContain(6730);
  });

  it("finds the same vote by a French keyword while returning German titles", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleSearchVotes({ query: "routes nationales" }));
    const vote = result.votes.find((v: { id: number }) => v.id === 6730);

    expect(vote).toBeDefined();
    expect(vote.title).toMatch(/Nationalstrassen/);
  });

  it("finds a vote by an Italian keyword", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleSearchVotes({ query: "malattie" }));

    expect(result.votes.map((v: { id: number }) => v.id)).toContain(6760);
  });

  it("ignores case", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleSearchVotes({ query: "nATIONALSTRASSEN" }));

    expect(result.votes.map((v: { id: number }) => v.id)).toContain(6730);
  });

  it("carries the full result so a match does not need a second call", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleSearchVotes({ query: "Nationalstrassen" }));
    const vote = result.votes.find((v: { id: number }) => v.id === 6730);

    expect(vote.yes_percent).toBe(47.3);
    expect(vote.accepted).toBe(false);
  });

  it("honours limit", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleSearchVotes({ query: "Änderung", limit: 1 }));

    expect(result.votes).toHaveLength(1);
  });

  it("reports no match without throwing", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleSearchVotes({ query: "zzzznotavote" }));

    expect(result.count).toBe(0);
    expect(result.hint).toBeTruthy();
  });

  it("rejects an empty query", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    await expect(handleSearchVotes({ query: "   " })).rejects.toThrow(/required/i);
  });
})

describe("handleGetVoteDetails", () => {
  it("returns the national totals for the matched vote", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(
      await handleGetVoteDetails({ vote_title: "Nationalstrassen" }),
    );

    expect(result.id).toBe(6730);
    expect(result.national.yes_percent).toBe(47.3);
    expect(result.national.accepted).toBe(false);
    expect(result.national.cantons_yes).toBe(9);
  });

  it("breaks the result down per canton, not per Basel district", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(
      await handleGetVoteDetails({ vote_title: "Nationalstrassen" }),
    );
    const names = result.cantons.map((c: { canton: string }) => c.canton);

    expect(names).toContain("Vaud");
    expect(names).toContain("Genève");
    expect(names).not.toContain("Riehen");
  });

  it("gives each canton its own counts and turnout", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(
      await handleGetVoteDetails({ vote_title: "Nationalstrassen" }),
    );
    const vaud = result.cantons.find((c: { canton: string }) => c.canton === "Vaud");

    expect(vaud.yes_count).toBe(92549);
    expect(vaud.no_count).toBe(131045);
    expect(vaud.yes_percent).toBe(41.39);
    expect(vaud.turnout).toBe(47.42);
  });

  it("includes the vote type and themes", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(
      await handleGetVoteDetails({ vote_title: "Nationalstrassen" }),
    );

    expect(result.type).toBe("Fakultatives Referendum");
    expect(result.themes).toEqual(["Strassenbau", "Umwelt", "Boden"]);
  });

  it("does not download the 10 MB canton file for a plain results call", async () => {
    const fetchMock = mockCsv(ALL_CSV);

    await handleGetVotingResults({ year: 2024 });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(CANTON_ASSET))).toBe(false);
  });

  it("reads the canton file once across repeated detail calls", async () => {
    const fetchMock = mockCsv(ALL_CSV);

    await handleGetVoteDetails({ vote_title: "Nationalstrassen" });
    await handleGetVoteDetails({ vote_title: "Nationalstrassen" });

    const cantonCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes(CANTON_ASSET),
    );
    expect(cantonCalls).toHaveLength(1);
  });

  it("lists the candidates when a date matches several votes", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(await handleGetVoteDetails({ date: "2024-11-24" }));

    expect(result.matches).toHaveLength(4);
    expect(result.hint).toBeTruthy();
    expect(result.cantons).toBeUndefined();
  });

  it("combines title and date to pick one vote out of a busy day", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(
      await handleGetVoteDetails({ date: "2024-11-24", vote_title: "Ausbauschritt" }),
    );

    expect(result.id).toBe(6730);
  });

  it("requires vote_title or date", async () => {
    mockCsv(ALL_CSV);

    await expect(handleGetVoteDetails({})).rejects.toThrow(/vote_title or date/i);
  });

  it("explains when nothing matches", async () => {
    mockCsv(ALL_CSV);

    await expect(handleGetVoteDetails({ vote_title: "zzzznotavote" })).rejects.toThrow(
      /no federal vote/i,
    );
  });

  it("says so when canton figures are not available for an old vote", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(await handleGetVoteDetails({ date: "1848-06-06" }));

    expect(result.id).toBe(10);
    expect(result.cantons).toEqual([]);
    expect(result.note).toMatch(/canton/i);
  });
});

describe("cantonal majority (Ständemehr)", () => {
  it("is false when the requirement applied and the vote failed it", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(await handleSearchVotes({ query: "Wirtschaftsraum" }));
    const vote = result.votes.find((v: { id: number }) => v.id === EXPECTED_EWR.id);

    expect(vote.cantonal_majority).toBe(EXPECTED_EWR.cantonal_majority);
    expect(vote.cantons_yes).toBe(EXPECTED_EWR.cantons_yes);
    expect(vote.cantons_no).toBe(EXPECTED_EWR.cantons_no);
    expect(vote.turnout).toBe(EXPECTED_EWR.turnout);
  });

  it("is true when the requirement applied and was met", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(await handleGetVotingResults({ year: 1848 }));
    const vote = result.votes.find((v: { id: number }) => v.id === 10);

    expect(vote.cantonal_majority).toBe(true);
  });

  it("is null for an ordinary law change, where no cantonal majority is needed", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(await handleGetVotingResults({ year: 2024 }));
    const vote = result.votes.find((v: { id: number }) => v.id === 6730);

    expect(vote.cantonal_majority).toBeNull();
  });
});
