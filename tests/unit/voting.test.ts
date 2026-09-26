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
  EXPECTED_KONZERNVERANTWORTUNG,
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

describe("parseCsv edge cases", () => {
  it("strips a byte order mark from the first header", () => {
    expect(Object.keys(parseCsv('\uFEFF"a","b"\n1,2')[0])).toEqual(["a", "b"]);
  });

  it("reads a doubled quote inside a quoted field as one quote", () => {
    expect(parseCsv('"a"\n"say ""hi"""')[0].a).toBe('say "hi"');
  });

  it("keeps an empty field between two commas", () => {
    const [row] = parseCsv('"a","b","c"\n1,,3');
    expect(row).toEqual({ a: "1", b: "", c: "3" });
  });

  it("handles CRLF line endings and a missing final newline", () => {
    const rows = parseCsv('"a","b"\r\n1,2\r\n3,4');
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("keeps a newline that sits inside a quoted field", () => {
    expect(parseCsv('"a","b"\n"x\ny",2')[0].a).toBe("x\ny");
  });
});

describe("limits", () => {
  it.each([0, -1, -50])("returns at least one vote for limit %s, never the tail", async (limit) => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ limit }));

    expect(result.count).toBe(1);
    expect(result.votes[0].date).toBe("2026-06-14");
  });

  it("clamps a search limit of -1 to one result", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleSearchVotes({ query: "e", limit: -1 }));

    expect(result.count).toBe(1);
  });

  it("rejects a search keyword that is not a keyword", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    await expect(handleSearchVotes({ query: "a".repeat(500) })).rejects.toThrow(/too long/i);
  });
});

describe("as_of and source on every response", () => {
  it("is present when a year has no vote", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 1700 }));

    expect(result.count).toBe(0);
    expect(result.as_of).toBe("2026-06-14");
  });

  it("is present when a search finds nothing", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleSearchVotes({ query: "zzzznotavote" }));

    expect(result.as_of).toBe("2026-06-14");
    expect(result.source).toBeTruthy();
  });

  it("is present when several votes match", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(await handleGetVoteDetails({ date: "2024-11-24" }));

    expect(result.as_of).toBe("2026-06-14");
  });
});

describe("get_vote_details lookup", () => {
  it("finds a vote by the id search_votes returned", async () => {
    mockCsv(ALL_CSV);

    const search = JSON.parse(await handleSearchVotes({ query: "Wirtschaftsraum" }));
    const result = JSON.parse(await handleGetVoteDetails({ id: search.votes[0].id }));

    expect(result.id).toBe(EXPECTED_EWR.id);
    expect(result.cantons.length).toBeGreaterThan(0);
  });

  it("finds a vote by id when the date alone would be ambiguous", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(await handleGetVoteDetails({ id: 6730 }));

    expect(result.title).toMatch(/Nationalstrassen/);
  });

  it("explains an unknown id", async () => {
    mockCsv(ALL_CSV);

    await expect(handleGetVoteDetails({ id: 999999 })).rejects.toThrow(/no federal vote/i);
  });

  it("treats a blank vote_title as missing instead of matching every vote", async () => {
    mockCsv(ALL_CSV);

    await expect(handleGetVoteDetails({ vote_title: "   " })).rejects.toThrow(/id, vote_title or date/i);
  });

  it("caps the candidate list and reports how many matched", async () => {
    const header = '"vorlage_id","vorlage_titel_de","urnengang_datum","daten_stand"';
    const many = Array.from({ length: 30 }, (_, i) => `${i + 1},"Vorlage ${i + 1}","2000-01-${String(i + 1).padStart(2, "0")}",2026-01-01 00:00:00`);
    mockCsv({
      [NATIONAL_ASSET]: [header, ...many].join("\n"),
      [CANTON_ASSET]: '"vorlage_id"\n1',
      [META_ASSET]: '"vorlage_id"\n1',
    });

    const result = JSON.parse(await handleGetVoteDetails({ vote_title: "Vorlage" }));

    expect(result.total_matches).toBe(30);
    expect(result.matches).toHaveLength(20);
    expect(result.matches[0].date).toBe("2000-01-30");
  });
});

describe("Ständemehr and passed are independent", () => {
  it("does not derive accepted from the yes share: 50.7% yes still failed on the cantons", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleSearchVotes({ query: "verantwortungsvolle" }));
    const vote = result.votes[0];

    expect(vote.id).toBe(EXPECTED_KONZERNVERANTWORTUNG.id);
    expect(vote.yes_percent).toBe(EXPECTED_KONZERNVERANTWORTUNG.yes_percent);
    expect(vote.accepted).toBe(false);
    expect(vote.cantons_yes).toBe(EXPECTED_KONZERNVERANTWORTUNG.cantons_yes);
    expect(vote.cantons_no).toBe(EXPECTED_KONZERNVERANTWORTUNG.cantons_no);
    expect(vote.cantonal_majority).toBe(false);
  });
});

describe("provisional results", () => {
  it("flags a result BFS still marks as provisional", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ limit: 1 }));

    expect(result.votes[0].provisional).toBe(true);
  });

  it("omits the flag on a final result", async () => {
    mockCsv({ [NATIONAL_ASSET]: NATIONAL_CSV });

    const result = JSON.parse(await handleGetVotingResults({ year: 2024 }));

    expect(result.votes[0]).not.toHaveProperty("provisional");
  });
});

describe("canton rows", () => {
  it("lists cantons in BFS order, not file order", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(await handleGetVoteDetails({ id: 6730 }));

    // The fixture file lists Vaud (22), Genève (25), Uri (4), Zürich (1).
    expect(result.cantons.map((c: { canton: string }) => c.canton)).toEqual([
      "Zürich",
      "Uri",
      "Vaud",
      "Genève",
    ]);
  });

  // BFS lists some cantons twice for 1960-1981. Synthetic data: the point is
  // which variant is kept, so the counts are small enough to check by hand.
  const NATIONAL_HEADER = '"vorlage_id","vorlage_titel_de","urnengang_datum","stimmen_ja","stimmen_nein","daten_stand"';
  const CANTON_HEADER = '"vorlage_id","kanton_nummer","kanton_bezeichnung","stimmen_ja","stimmen_nein","stimmberechtigte"';

  function duplicated(cantonRows: string[]) {
    mockCsv({
      [NATIONAL_ASSET]: `${NATIONAL_HEADER}\n7,"Testvorlage","1975-01-01",30,70,2026-01-01 00:00:00`,
      [CANTON_ASSET]: [CANTON_HEADER, ...cantonRows].join("\n"),
      [META_ASSET]: '"vorlage_id"\n7',
    });
  }

  it("returns one row per canton and keeps the variant that adds up, when that is the last", async () => {
    duplicated([
      '7,1,"Zürich",10,30,100',
      '7,2,"Bern",21,41,100', // stale variant
      '7,2,"Bern",20,40,100',
    ]);

    const result = JSON.parse(await handleGetVoteDetails({ id: 7 }));

    expect(result.cantons).toHaveLength(2);
    expect(result.cantons[1]).toMatchObject({ canton: "Bern", yes_count: 20, no_count: 40 });
    expect(result.note).toBeUndefined();
  });

  it("keeps the variant that adds up when that is the first", async () => {
    duplicated([
      '7,1,"Zürich",10,30,100',
      '7,2,"Bern",20,40,100',
      '7,2,"Bern",21,41,100', // stale variant
    ]);

    const result = JSON.parse(await handleGetVoteDetails({ id: 7 }));

    expect(result.cantons).toHaveLength(2);
    expect(result.cantons[1]).toMatchObject({ yes_count: 20, no_count: 40 });
  });

  it("says so when neither variant adds up to the national result", async () => {
    duplicated([
      '7,1,"Zürich",10,30,100',
      '7,2,"Bern",99,99,100',
      '7,2,"Bern",98,98,100',
    ]);

    const result = JSON.parse(await handleGetVoteDetails({ id: 7 }));

    expect(result.cantons).toHaveLength(2);
    expect(result.note).toMatch(/do not add up/i);
  });

  it("leaves a vote without duplicates untouched", async () => {
    mockCsv(ALL_CSV);

    const result = JSON.parse(await handleGetVoteDetails({ id: 6730 }));

    expect(result.cantons).toHaveLength(4);
    expect(result.note).toBeUndefined();
  });
});

describe("cache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one download between concurrent cold calls", async () => {
    const fetchMock = mockCsv(ALL_CSV);

    await Promise.all([
      handleGetVotingResults({}),
      handleGetVotingResults({}),
      handleSearchVotes({ query: "Miet" }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("downloads again once the data is older than the TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchMock = mockCsv(ALL_CSV);

    await handleGetVotingResults({});
    vi.setSystemTime(Date.now() + 5 * 60 * 60 * 1000);
    await handleGetVotingResults({});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    await handleGetVotingResults({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed download", async () => {
    mockCsv({ [NATIONAL_ASSET]: "not a csv at all" });
    await expect(handleGetVotingResults({})).rejects.toThrow();

    mockCsv(ALL_CSV);
    const result = JSON.parse(await handleGetVotingResults({}));
    expect(result.count).toBeGreaterThan(0);
  });
});

describe("unexpected upstream content", () => {
  it("fails loudly on an HTML page served with a 200, instead of reporting no votes", async () => {
    mockCsv({ [NATIONAL_ASSET]: "<html><body>Service unavailable</body></html>" });

    await expect(handleGetVotingResults({})).rejects.toThrow(/unexpected format/i);
  });

  it("fails loudly on an empty body", async () => {
    mockCsv({ [NATIONAL_ASSET]: "" });

    await expect(handleSearchVotes({ query: "Miet" })).rejects.toThrow(/unexpected format/i);
  });
});
