import { describe, expect, it } from "vitest";
import { EMPTY_KEY_DATES, businessDaysAfter, deriveWindows, pickBulletinEntry, priorityStanding, remindersDue, standingAgainst, type DocketItem } from "../src/store-docket.js";
import { parseRfeAsks, unverifiedQuotes } from "../src/rfe.js";
import type { Fact } from "../src/types.js";

function item(id: string, daysLeft: number, met = false): DocketItem {
  return { id, title: id, dueOn: "2026-10-01", kind: "other", source: "attorney", met, daysLeft, urgency: "later", provenance: "docketed", derivedFrom: null };
}

describe("derived windows", () => {
  it("derives nothing from empty key dates", () => {
    expect(deriveWindows(EMPTY_KEY_DATES)).toEqual([]);
  });
  it("derives the I-94, status, EAD (window and expiry), cap and premium clocks with stable ids", () => {
    const w = deriveWindows({ ...EMPTY_KEY_DATES, i94Expiry: "2027-01-15", statusEnd: "2027-01-15", eadExpiry: "2027-06-30", h1bCapYear: 2028, premiumFiledOn: "2026-09-01" });
    expect(w.map(x => x.id)).toEqual(["derived:i94", "derived:status", "derived:ead-window", "derived:ead", "derived:h1b-cap", "derived:premium"]);
    expect(w.find(x => x.id === "derived:ead-window")?.dueOn).toBe("2027-01-01");
    expect(w.find(x => x.id === "derived:h1b-cap")?.dueOn).toBe("2027-03-01");
    expect(w.every(x => x.derivedFrom.length > 0)).toBe(true);
  });
  it("counts business days for the premium clock (weekends skipped)", () => {
    // Tue 2026-09-01 + 15 business days = Tue 2026-09-22
    expect(businessDaysAfter("2026-09-01", 15)).toBe("2026-09-22");
  });
  it("ignores malformed dates rather than deriving a wrong window", () => {
    expect(deriveWindows({ ...EMPTY_KEY_DATES, i94Expiry: "next year" })).toEqual([]);
  });
});

describe("reminders once per threshold", () => {
  it("fires the smallest crossed threshold that has not fired", () => {
    const due = remindersDue([item("a", 10)], new Set());
    // Ten days out, the 14-day reminder is the truthful one; a 7-day note would be a lie.
    expect(due).toEqual([{ item: item("a", 10), threshold: 14 }]);
  });
  it("never fires the same threshold twice", () => {
    expect(remindersDue([item("a", 10)], new Set(["a:14", "a:7"]))).toEqual([]);
  });
  it("fires again when a lower threshold is crossed later", () => {
    expect(remindersDue([item("a", 1)], new Set(["a:14", "a:7"]))).toEqual([{ item: item("a", 1), threshold: 1 }]);
  });
  it("fires the overdue (0) threshold once, and never for met items", () => {
    expect(remindersDue([item("a", -3)], new Set(["a:30", "a:14", "a:7", "a:1"]))).toEqual([{ item: item("a", -3), threshold: 0 }]);
    expect(remindersDue([item("a", -3, true)], new Set())).toEqual([]);
  });
  it("leaves far-off items alone", () => {
    expect(remindersDue([item("a", 45)], new Set())).toEqual([]);
  });
});

describe("the RFE ask parser", () => {
  const raw = `Some preamble. {"received_on":"2026-08-20","response_due":"2026-11-18","summary":"The officer doubts the awards and the leading role.","asks":[
    {"title":"Awards","ask":"Submit evidence that the 2021 award is nationally or internationally recognized.","criterion":"awards","evidence_requested":"selection criteria, pool size, press"},
    {"title":"Leading role","ask":"Submit evidence of a leading or critical role.","criterion":"not_a_key","evidence_requested":"org chart"},
    {"ask":"","criterion":"awards"}
  ]} trailing`;
  it("keeps the notice's order, drops empty asks, nulls unknown criteria, reads the dates", () => {
    const p = parseRfeAsks(raw, new Set(["awards", "leading_role"]));
    expect(p.receivedOn).toBe("2026-08-20");
    expect(p.responseDue).toBe("2026-11-18");
    expect(p.asks).toHaveLength(2);
    expect(p.asks[0].criterion).toBe("awards");
    expect(p.asks[1].criterion).toBeNull();
    expect(p.asks[1].title).toBe("Leading role");
  });
  it("says so when there is no JSON", () => {
    expect(() => parseRfeAsks("no json here", new Set())).toThrow(/no JSON/);
  });
});

describe("RFE response quote verification", () => {
  const facts = [{ id: "f1", quote: "elevated to the grade of IEEE Fellow" }] as Fact[];
  it("passes a quote the record contains and flags one it does not", () => {
    expect(unverifiedQuotes('The letter states she was "elevated to the grade of IEEE Fellow" in 2019.', facts)).toEqual([]);
    expect(unverifiedQuotes('The letter states "the highest honor in the field".', facts)).toEqual(["the highest honor in the field"]);
  });
});

describe("priority standing against the Visa Bulletin", () => {
  const entries = [
    { category: "EB-1", chargeability: "All Chargeability Areas", finalAction: "C", datesForFiling: "C" },
    { category: "EB-2", chargeability: "All Chargeability Areas", finalAction: "2024-03-15", datesForFiling: "2024-08-01" },
    { category: "EB-2", chargeability: "India", finalAction: "2013-01-01", datesForFiling: "2013-04-01" },
    { category: "EB-3", chargeability: "China", finalAction: "U", datesForFiling: null },
  ];

  it("picks the row by category and chargeability, defaulting to all chargeability areas", () => {
    expect(pickBulletinEntry(entries, "EB2", null)?.finalAction).toBe("2024-03-15");
    expect(pickBulletinEntry(entries, "EB-2", "All other")?.finalAction).toBe("2024-03-15");
    expect(pickBulletinEntry(entries, "EB-2", "India")?.finalAction).toBe("2013-01-01");
    expect(pickBulletinEntry(entries, "EB-5", null)).toBeNull();
  });

  it("reads C, U and a cutoff date; the priority date must fall before the cutoff", () => {
    expect(standingAgainst("2025-01-01", entries[0])).toBe(true);
    expect(standingAgainst("2024-03-14", entries[1])).toBe(true);
    expect(standingAgainst("2024-03-15", entries[1])).toBe(false);
    expect(standingAgainst("2010-01-01", entries[3])).toBe(false);
    expect(standingAgainst("2010-01-01", { ...entries[1], finalAction: "soon" })).toBeNull();
  });

  it("degrades honestly without the service and with a failed answer", async () => {
    const dates = { ...EMPTY_KEY_DATES, priorityDate: "2020-01-01", preferenceCategory: "EB-2", chargeability: "India" };
    expect(await priorityStanding(EMPTY_KEY_DATES, undefined)).toBeNull();
    expect((await priorityStanding(dates, undefined))?.current).toBeNull();
    const failing = { visaBulletin: async () => ({ ok: false, note: "travel.state.gov timed out", result: null }) };
    expect(await priorityStanding(dates, failing)).toEqual({ current: null, note: "travel.state.gov timed out" });
    const ok = { visaBulletin: async () => ({ ok: true, note: null, result: { month: "September 2026", url: "u", entries } }) };
    const standing = await priorityStanding(dates, ok);
    expect(standing?.current).toBe(false);
    expect(standing?.note).toContain("2013-01-01");
  });
});
