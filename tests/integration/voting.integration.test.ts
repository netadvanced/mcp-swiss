// Integration tests for the voting module — hit the live BFS CSV exports.
// Run with: npm run test:integration

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  handleGetVotingResults,
  handleSearchVotes,
  handleGetVoteDetails,
  clearVotingCache,
} from "../../src/modules/voting.js";

/** The per-canton file is ~10 MB, so the detail tests need room. */
const SLOW = 150_000;

beforeAll(() => clearVotingCache());
afterAll(() => clearVotingCache());

describe("get_voting_results (live)", () => {
  it("returns recent federal votes", async () => {
    const result = JSON.parse(await handleGetVotingResults({}));

    expect(result.count).toBeGreaterThan(0);
    expect(result.source).toMatch(/BFS/);
  });

  it("gives every vote an ISO date and a title", async () => {
    const result = JSON.parse(await handleGetVotingResults({ limit: 20 }));

    for (const vote of result.votes) {
      expect(vote.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof vote.title).toBe("string");
      expect(vote.title.length).toBeGreaterThan(0);
      expect(typeof vote.accepted).toBe("boolean");
    }
  });

  it("keeps turnout and yes share inside a plausible range", async () => {
    const result = JSON.parse(await handleGetVotingResults({ limit: 30 }));

    for (const vote of result.votes) {
      if (vote.turnout !== null) {
        expect(vote.turnout).toBeGreaterThan(0);
        expect(vote.turnout).toBeLessThanOrEqual(100);
      }
      if (vote.yes_percent !== null) {
        expect(vote.yes_percent).toBeGreaterThanOrEqual(0);
        expect(vote.yes_percent).toBeLessThanOrEqual(100);
      }
    }
  });

  it("reaches back to the first federal votes of 1848", async () => {
    const result = JSON.parse(await handleGetVotingResults({ year: 1848 }));

    expect(result.count).toBeGreaterThan(0);
    expect(result.votes[0].date.startsWith("1848")).toBe(true);
  });

  it("reports how current the data is", async () => {
    const result = JSON.parse(await handleGetVotingResults({}));

    expect(result.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("stays well under the response budget", async () => {
    const raw = await handleGetVotingResults({ limit: 50 });

    expect(raw.length).toBeLessThan(50000);
  });
});

describe("search_votes (live)", () => {
  // The 1992 EEA vote is settled history: rejected on 49.7% yes with the
  // cantons 7 : 16, so it is a safe anchor for real numbers.
  it("finds the 1992 EEA vote with its actual national result", async () => {
    const result = JSON.parse(await handleSearchVotes({ query: "Wirtschaftsraum" }));
    const vote = result.votes.find((v: { id: number }) => v.id === 3880);

    expect(vote).toBeDefined();
    expect(vote.date).toBe("1992-12-06");
    expect(vote.accepted).toBe(false);
    expect(vote.yes_percent).toBeCloseTo(49.66, 1);
    expect(vote.turnout).toBeCloseTo(78.74, 1);
    expect(vote.cantons_yes).toBe(7);
    expect(vote.cantons_no).toBe(16);
    expect(vote.cantonal_majority).toBe(false);
  });

  it("finds the same vote from its French title", async () => {
    const result = JSON.parse(
      await handleSearchVotes({ query: "espace économique", lang: "fr" }),
    );
    const vote = result.votes.find((v: { id: number }) => v.id === 3880);

    expect(vote).toBeDefined();
    expect(vote.title).toMatch(/espace économique/i);
  });

  it("returns an empty result rather than failing on a nonsense keyword", async () => {
    const result = JSON.parse(await handleSearchVotes({ query: "zzzznotavote" }));

    expect(result.count).toBe(0);
    expect(result.votes).toEqual([]);
  });

  it("stays well under the response budget", async () => {
    const raw = await handleSearchVotes({ query: "Initiative", limit: 20 });

    expect(raw.length).toBeLessThan(50000);
  });
});

describe("get_vote_details (live)", () => {
  it(
    "breaks the 1992 EEA vote down across all 26 cantons",
    async () => {
      const result = JSON.parse(
        await handleGetVoteDetails({ vote_title: "Europäischen Wirtschaftsraum" }),
      );

      expect(result.id).toBe(3880);
      expect(result.cantons).toHaveLength(26);

      const names = result.cantons.map((c: { canton: string }) => c.canton);
      expect(names).toContain("Vaud");
      expect(names).toContain("Uri");

      for (const canton of result.cantons) {
        expect(canton.yes_count).toBeGreaterThan(0);
        expect(canton.yes_percent).toBeGreaterThanOrEqual(0);
        expect(canton.yes_percent).toBeLessThanOrEqual(100);
      }
    },
    SLOW,
  );

  it(
    "carries the vote type and at least one theme",
    async () => {
      const result = JSON.parse(
        await handleGetVoteDetails({ vote_title: "Europäischen Wirtschaftsraum" }),
      );

      expect(typeof result.type).toBe("string");
      expect(result.type.length).toBeGreaterThan(0);
      expect(result.themes.length).toBeGreaterThan(0);
    },
    SLOW,
  );

  it(
    "offers the candidates instead of guessing when a date holds several votes",
    async () => {
      const result = JSON.parse(await handleGetVoteDetails({ date: "2024-11-24" }));

      expect(result.matches.length).toBeGreaterThan(1);
      expect(result.cantons).toBeUndefined();
    },
    SLOW,
  );

  it(
    "stays well under the response budget with all 26 cantons",
    async () => {
      const raw = await handleGetVoteDetails({
        vote_title: "Europäischen Wirtschaftsraum",
      });

      expect(raw.length).toBeLessThan(50000);
    },
    SLOW,
  );

  it("rejects a call with neither title nor date", async () => {
    await expect(handleGetVoteDetails({})).rejects.toThrow(/vote_title or date/i);
  });
});
