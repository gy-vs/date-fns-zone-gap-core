import { describe, expect, it } from "vitest";
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
} from "date-fns";
import { constructFromSymbol } from "../../src/constants/index.ts";
import { TZDate } from "../../src/index.ts";

// These tests pin down the resolution of local times that do not exist
// (spring-forward gap) or exist twice (fall-back overlap) when a TZDate is
// built from year/month/day/hours/minutes components.
//
// Before the fix the components were first parsed through the *machine* time
// zone and then bent back into the target zone with a set of heuristics that
// only covered a one-hour gap when the machine zone happened to be aligned.
// Half-hour DST, :45 offsets, midnight gaps and machines in a different zone
// produced machine-dependent instants, which then leaked into add, startOfDay,
// differenceInCalendarDays, format and withTimeZone.
//
// The instants asserted here match what a native `Date` constructed on a
// machine running in the target zone would produce, and are independent of the
// machine running the tests (the suite is executed under many `TZ` values).

describe("spring-forward gap", () => {
  describe("America/New_York (2022-03-13, 02:00 -> 03:00)", () => {
    // 02:30 does not exist; it is forward-shifted to 03:30 EDT (07:30 UTC).
    const GAP = Date.UTC(2022, 2, 13, 7, 30);

    it("constructs the missing local time consistently from components", () => {
      const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/New_York");

      expect(+date).toBe(GAP);
      expect(date.getFullYear()).toBe(2022);
      expect(date.getMonth()).toBe(2);
      expect(date.getDate()).toBe(13);
      expect(date.getHours()).toBe(3);
      expect(date.getMinutes()).toBe(30);
      expect(date.getTimezoneOffset()).toBe(240);
      expect(date.toISOString()).toBe("2022-03-13T03:30:00.000-04:00");
    });

    it("supports every arity of the components constructor", () => {
      expect(+new TZDate(2022, 2, 13, 2, 30, "America/New_York")).toBe(GAP);
      expect(+new TZDate(2022, 2, 13, 2, 30, 0, "America/New_York")).toBe(GAP);
      expect(+new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/New_York")).toBe(
        GAP,
      );
    });

    it("resolves the gap edges", () => {
      // 01:59 still exists in EST.
      expect(+new TZDate(2022, 2, 13, 1, 59, 0, 0, "America/New_York")).toBe(
        Date.UTC(2022, 2, 13, 6, 59),
      );
      // 02:00 is the start of the gap -> 03:00 EDT.
      expect(+new TZDate(2022, 2, 13, 2, 0, 0, 0, "America/New_York")).toBe(
        Date.UTC(2022, 2, 13, 7, 0),
      );
      // 03:00 is the first valid post-transition wall time.
      expect(+new TZDate(2022, 2, 13, 3, 0, 0, 0, "America/New_York")).toBe(
        Date.UTC(2022, 2, 13, 7, 0),
      );
    });

    it("keeps startOfDay at midnight in the target zone", () => {
      const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/New_York");
      expect(+startOfDay(date)).toBe(Date.UTC(2022, 2, 13, 5, 0));
    });

    it("keeps add arithmetic on the shifted instant", () => {
      const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/New_York");
      expect(+addDays(date, 1)).toBe(Date.UTC(2022, 2, 14, 7, 30));
    });

    it("counts calendar days across the gap", () => {
      const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/New_York");
      const next = new TZDate(2022, 2, 14, 0, 0, 0, 0, "America/New_York");
      expect(differenceInCalendarDays(next, date)).toBe(1);
    });

    it("formats the shifted wall time", () => {
      const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/New_York");
      expect(format(date, "yyyy-MM-dd HH:mm xxx")).toBe(
        "2022-03-13 03:30 -04:00",
      );
    });

    it("carries the resolved instant into withTimeZone", () => {
      const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/New_York");
      const singapore = date.withTimeZone("Asia/Singapore");
      expect(+singapore).toBe(GAP);
      expect(singapore.toISOString()).toBe("2022-03-13T15:30:00.000+08:00");
    });

    it("is stable when constructed repeatedly", () => {
      for (let i = 0; i < 5; i++) {
        expect(+new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/New_York")).toBe(
          GAP,
        );
      }
    });

    it("lands on the gap when set from an existing date", () => {
      const date = new TZDate(0, "America/New_York");
      date.setFullYear(2022, 2, 13);
      date.setHours(2, 30, 0, 0);
      expect(+date).toBe(GAP);
      expect(date.getHours()).toBe(3);
    });
  });

  describe("half-hour and non-standard gaps", () => {
    it("resolves the Pacific/Chatham one-hour gap at +12:45/+13:45", () => {
      // 03:30 on 2022-09-25 does not exist; forward-shifted to 04:30 +13:45.
      const date = new TZDate(2022, 8, 25, 3, 30, 0, 0, "Pacific/Chatham");
      expect(+date).toBe(Date.UTC(2022, 8, 24, 14, 45));
      expect(date.toISOString()).toBe("2022-09-25T04:30:00.000+13:45");
    });

    it("resolves the America/St_Johns one-hour gap at -03:30/-02:30", () => {
      const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/St_Johns");
      expect(+date).toBe(Date.UTC(2022, 2, 13, 6, 0));
      expect(date.toISOString()).toBe("2022-03-13T03:30:00.000-02:30");
    });

    it("resolves the America/Santiago midnight gap", () => {
      // Clocks jump 00:00 -> 01:00 on 2022-09-11; 00:30 shifts to 01:30 -03:00.
      const date = new TZDate(2022, 8, 11, 0, 30, 0, 0, "America/Santiago");
      expect(+date).toBe(Date.UTC(2022, 8, 11, 4, 30));
      expect(+startOfDay(date)).toBe(Date.UTC(2022, 8, 11, 4, 0));
    });
  });
});

describe("fall-back overlap", () => {
  describe("America/New_York (2022-11-06, 02:00 -> 01:00)", () => {
    // 01:30 occurs twice; the first (earlier, EDT -04:00) occurrence wins.
    const FIRST = Date.UTC(2022, 10, 6, 5, 30);

    it("constructs the first occurrence of the repeated hour", () => {
      const date = new TZDate(2022, 10, 6, 1, 30, 0, 0, "America/New_York");
      expect(+date).toBe(FIRST);
      expect(date.getTimezoneOffset()).toBe(240);
      expect(date.toISOString()).toBe("2022-11-06T01:30:00.000-04:00");
    });

    it("keeps startOfDay and add anchored to the first occurrence", () => {
      const date = new TZDate(2022, 10, 6, 1, 30, 0, 0, "America/New_York");
      expect(+startOfDay(date)).toBe(Date.UTC(2022, 10, 6, 4, 0));
      // addDays adds a calendar day and keeps the local 01:30, which is EST
      // (-05:00) on November 7.
      expect(+addDays(date, 1)).toBe(Date.UTC(2022, 10, 7, 6, 30));
    });

    it("formats the first occurrence with the summer offset", () => {
      const date = new TZDate(2022, 10, 6, 1, 30, 0, 0, "America/New_York");
      expect(format(date, "yyyy-MM-dd HH:mm xxx")).toBe(
        "2022-11-06 01:30 -04:00",
      );
    });
  });

  it("resolves the half-hour Pacific/Chatham overlap to the first reading", () => {
    // 03:30 on 2022-04-03 occurs at +13:45 (first) then +12:45.
    const date = new TZDate(2022, 3, 3, 3, 30, 0, 0, "Pacific/Chatham");
    expect(+date).toBe(Date.UTC(2022, 3, 2, 13, 45));
    expect(date.toISOString()).toBe("2022-04-03T03:30:00.000+13:45");
  });

  it("resolves the half-hour Australia/Lord_Howe overlap to the first reading", () => {
    // 01:45 on 2022-04-03 occurs at +11:00 (first) then +10:30.
    const date = new TZDate(2022, 3, 3, 1, 45, 0, 0, "Australia/Lord_Howe");
    expect(+date).toBe(Date.UTC(2022, 3, 2, 14, 45));
  });

  it("resolves the Africa/Casablanca Ramadan fall-back to the first reading", () => {
    // Clocks fall back from +01:00 to +00:00 at 03:00 on 2022-03-27; 02:30
    // first occurs at +01:00 (01:30 UTC).
    const date = new TZDate(2022, 2, 27, 2, 30, 0, 0, "Africa/Casablanca");
    expect(+date).toBe(Date.UTC(2022, 2, 27, 1, 30));
  });
});

describe("preserved constructor semantics", () => {
  it("keeps plain timestamps, strings and Date instances absolute", () => {
    const ts = Date.UTC(2022, 2, 13, 7, 30);
    expect(+new TZDate(ts, "America/New_York")).toBe(ts);
    expect(+new TZDate("2022-03-13T07:30:00.000Z", "America/New_York")).toBe(
      ts,
    );
    expect(+new TZDate(new Date(ts), "America/New_York")).toBe(ts);
  });

  it("interoperates with the date-fns constructDateFrom symbol", () => {
    const gap = new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/New_York");
    const copied = gap[constructFromSymbol](+gap);
    expect(copied).toBeInstanceOf(TZDate);
    expect(copied.timeZone).toBe("America/New_York");
    expect(+copied).toBe(+gap);
  });

  it("does not touch ordinary unambiguous dates", () => {
    const date = new TZDate(2022, 6, 15, 12, 0, 0, 0, "America/New_York");
    expect(+date).toBe(Date.UTC(2022, 6, 15, 16, 0));
    expect(date.toISOString()).toBe("2022-07-15T12:00:00.000-04:00");
  });

  it("keeps historical sub-minute offsets working", () => {
    const date = new TZDate(1880, 0, 1, "America/New_York");
    expect(date.toISOString()).toBe("1880-01-01T00:00:00.000-04:56");
  });
});
