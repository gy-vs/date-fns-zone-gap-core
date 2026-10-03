import {
  add,
  addDays,
  differenceInCalendarDays,
  differenceInDays,
  format,
  parse,
  startOfDay,
} from "date-fns";
import { describe, expect, it } from "vitest";
import { TZDate, TZDateMini, tz } from "../../src/index.ts";

// Regression tests for constructing a `TZDate` from wall-clock components
// inside DST gaps and repeated hours. Before the fix the wall-clock ->
// instant conversion went through the system time zone, producing different
// results depending on the machine's time zone.
//
// The assertions are written against fixed instants (`+date`), so they fail
// on the old implementation in some system time zones (e.g.
// Pacific/Marquesas, Pacific/Honolulu) while passing everywhere with the fix.

const NEW_YORK = "America/New_York";

describe("spring-forward gap construction", () => {
  it("resolves the non-existent 02:30 to 03:30 EDT", () => {
    // America/New_York skips 02:00-03:00 on 2022-03-13; 02:30 doesn't exist.
    const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);

    expect(+date).toBe(Date.UTC(2022, 2, 13, 7, 30, 0, 0));
    expect(date.toISOString()).toBe("2022-03-13T03:30:00.000-04:00");
    expect(date.getHours()).toBe(3);
    expect(date.getMinutes()).toBe(30);
  });

  it("moves every minute of the gap forward by exactly one hour", () => {
    for (let minutes = 0; minutes < 60; minutes++) {
      const gap = new TZDate(2022, 2, 13, 2, minutes, 0, 0, NEW_YORK);
      const after = new TZDate(2022, 2, 13, 3, minutes, 0, 0, NEW_YORK);
      expect(+gap, `02:${minutes} should resolve as 03:${minutes}`).toBe(
        +after,
      );
    }
  });

  it("keeps valid times around the gap untouched", () => {
    expect(+new TZDate(2022, 2, 13, 1, 59, 59, 999, NEW_YORK)).toBe(
      Date.UTC(2022, 2, 13, 6, 59, 59, 999),
    );
    expect(+new TZDate(2022, 2, 13, 3, 0, 0, 0, NEW_YORK)).toBe(
      Date.UTC(2022, 2, 13, 7, 0, 0, 0),
    );
    expect(+new TZDate(2022, 2, 13, 23, 30, 0, 0, NEW_YORK)).toBe(
      Date.UTC(2022, 2, 14, 3, 30, 0, 0),
    );
  });

  it("works the same for TZDateMini", () => {
    const date = new TZDateMini(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
    expect(+date).toBe(Date.UTC(2022, 2, 13, 7, 30, 0, 0));
    expect(date.getHours()).toBe(3);
  });

  it("works through TZDate.tz", () => {
    const date = TZDate.tz(NEW_YORK, 2022, 2, 13, 2, 30);
    expect(+date).toBe(Date.UTC(2022, 2, 13, 7, 30, 0, 0));
  });
});

describe("fall-back repeated hour construction", () => {
  it("selects the earlier (EDT) occurrence of 01:30", () => {
    // America/New_York repeats 01:00-02:00 on 2022-11-06: 01:30 exists at
    // 05:30Z (EDT, earlier) and 06:30Z (EST, later).
    const date = new TZDate(2022, 10, 6, 1, 30, 0, 0, NEW_YORK);

    expect(+date).toBe(Date.UTC(2022, 10, 6, 5, 30, 0, 0));
    expect(date.toISOString()).toBe("2022-11-06T01:30:00.000-04:00");
    expect(date.getTimezoneOffset()).toBe(240);
  });

  it("keeps every minute of the repeated hour on the EDT offset", () => {
    for (let minutes = 0; minutes < 60; minutes++) {
      const date = new TZDate(2022, 10, 6, 1, minutes, 0, 0, NEW_YORK);
      expect(+date, `01:${minutes} should be the EDT occurrence`).toBe(
        Date.UTC(2022, 10, 6, 5, minutes, 0, 0),
      );
    }
  });

  it("picks the earlier occurrence in southern-hemisphere fall-backs", () => {
    // Adelaide falls back from +10:30 to +09:30 on 2022-04-03 03:00 local,
    // repeating 02:00-03:00.
    const date = new TZDate(2022, 3, 3, 2, 30, 0, 0, "Australia/Adelaide");
    expect(+date).toBe(Date.UTC(2022, 3, 2, 16, 0, 0, 0));
    expect(date.toISOString()).toBe("2022-04-03T02:30:00.000+10:30");
  });

  it("supports 30-minute gaps and repeats (Lord Howe)", () => {
    // Lord Howe springs forward 30 minutes on 2022-10-02 02:00.
    const gap = new TZDate(2022, 9, 2, 2, 15, 0, 0, "Australia/Lord_Howe");
    expect(gap.toISOString()).toBe("2022-10-02T02:45:00.000+11:00");

    // And falls back 30 minutes on 2022-04-03 02:00.
    const repeat = new TZDate(2022, 3, 3, 1, 30, 0, 0, "Australia/Lord_Howe");
    expect(repeat.toISOString()).toBe("2022-04-03T01:30:00.000+11:00");
  });

  it("resolves gaps with unusual transition times (Chatham)", () => {
    // Chatham springs forward 02:45 -> 03:45 (+12:45 -> +13:45).
    expect(
      new TZDate(2022, 8, 25, 2, 45, 0, 0, "Pacific/Chatham").toISOString(),
    ).toBe("2022-09-25T03:45:00.000+13:45");
    expect(
      new TZDate(2022, 8, 25, 3, 15, 0, 0, "Pacific/Chatham").toISOString(),
    ).toBe("2022-09-25T04:15:00.000+13:45");
  });

  it("keeps historical dates with sub-minute offsets intact", () => {
    // Singapore LMT was UTC+06:55:25; components must stay at minute
    // precision while the instant includes the offset seconds.
    expect(
      new TZDate(1880, 0, 1, 0, 0, 0, 0, "Asia/Singapore").toISOString(),
    ).toBe("1880-01-01T00:00:00.000+06:55");
    const date = new TZDate(1900, 0, 1, "Asia/Singapore");
    date.setSeconds(56);
    expect(date.toISOString()).toBe("1900-01-01T00:00:31.000+06:55");
  });

  it("normalizes component overflows before resolving", () => {
    expect(+new TZDate(2022, 0, 32, 0, 0, 0, 0, "UTC")).toBe(
      Date.UTC(2022, 1, 1),
    );
    expect(+new TZDate(2022, 2, 14, -1, 0, 0, 0, "UTC")).toBe(
      Date.UTC(2022, 2, 13, 23),
    );
  });
});

describe("date-fns operations on gap dates", () => {
  it("format renders the resolved wall-clock time", () => {
    const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
    expect(format(date, "yyyy-MM-dd HH:mm xxx")).toBe(
      "2022-03-13 03:30 -04:00",
    );
  });

  it("add preserves the instant and the time zone", () => {
    const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
    const result = add(date, { days: 1 });
    expect(result.toISOString()).toBe("2022-03-14T03:30:00.000-04:00");
    expect(result).toBeInstanceOf(TZDate);
  });

  it("addDays preserves the instant across the gap", () => {
    const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
    expect(addDays(date, 1).toISOString()).toBe(
      "2022-03-14T03:30:00.000-04:00",
    );
    expect(addDays(date, -1).toISOString()).toBe(
      "2022-03-12T03:30:00.000-05:00",
    );
  });

  it("startOfDay lands on local midnight", () => {
    const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
    expect(startOfDay(date).toISOString()).toBe(
      "2022-03-13T00:00:00.000-05:00",
    );
  });

  it("differenceInDays counts local days", () => {
    const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
    const nextDay = new TZDate(2022, 2, 14, 12, 0, 0, 0, NEW_YORK);
    expect(differenceInDays(nextDay, date)).toBe(1);
    expect(differenceInCalendarDays(nextDay, date)).toBe(1);
  });

  it("repeated operations stay consistent", () => {
    let date = new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
    for (let i = 0; i < 3; i++) {
      date = addDays(date, 1);
    }
    expect(date.toISOString()).toBe("2022-03-16T03:30:00.000-04:00");
  });

  it("parses a gap wall time via the `in` option context", () => {
    const date = parse("2022-03-13 02:30", "yyyy-MM-dd HH:mm", new Date(), {
      in: tz(NEW_YORK),
    });
    expect(date.toISOString()).toBe("2022-03-13T03:30:00.000-04:00");
  });
});

describe("setters landing on the gap", () => {
  it("resolves setHours(2, 30) on the gap day", () => {
    const date = new TZDate(0, NEW_YORK);
    date.setFullYear(2022, 2, 13);
    date.setHours(2, 30, 0, 0);
    expect(+date).toBe(Date.UTC(2022, 2, 13, 7, 30, 0, 0));
    expect(date.toISOString()).toBe("2022-03-13T03:30:00.000-04:00");
  });

  it("resolves setMinutes into the gap", () => {
    const date = new TZDate(2022, 2, 13, 0, 0, 0, 0, NEW_YORK);
    date.setHours(2);
    date.setMinutes(30);
    expect(date.toISOString()).toBe("2022-03-13T03:30:00.000-04:00");
  });
});

describe("withTimeZone and mixed constructors", () => {
  it("withTimeZone keeps the exact instant", () => {
    const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
    expect(+date.withTimeZone("UTC")).toBe(+date);
    expect(date.withTimeZone("UTC").toISOString()).toBe(
      "2022-03-13T07:30:00.000+00:00",
    );
    expect(+date.withTimeZone("Asia/Kolkata")).toBe(+date);
    expect(date.withTimeZone("Asia/Kolkata").toISOString()).toBe(
      "2022-03-13T13:00:00.000+05:30",
    );
  });

  it("does not carry a stale offset into withTimeZone", () => {
    const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
    const shifted = date.withTimeZone("Asia/Singapore");
    expect(shifted.toISOString()).toBe("2022-03-13T15:30:00.000+08:00");
    expect(+shifted).toBe(+date);
  });

  it("converts between two gap-aware time zones", () => {
    const london = new TZDate(2022, 2, 13, 7, 30, 0, 0, "Europe/London");
    const ny = london.withTimeZone(NEW_YORK);
    expect(ny.toISOString()).toBe("2022-03-13T03:30:00.000-04:00");
    expect(ny.withTimeZone("Europe/London").toISOString()).toBe(
      "2022-03-13T07:30:00.000+00:00",
    );
  });

  it("preserves non-components input semantics", () => {
    const instant = Date.UTC(2022, 2, 13, 7, 30, 0, 0);
    // Timestamp
    expect(+new TZDate(instant, NEW_YORK)).toBe(instant);
    // ISO string
    expect(+new TZDate("2022-03-13T07:30:00.000Z", NEW_YORK)).toBe(instant);
    // Plain Date
    expect(+new TZDate(new Date(instant), NEW_YORK)).toBe(instant);
  });

  it("produces an Invalid Date for an invalid time zone", () => {
    expect(+new TZDate(2022, 2, 13, 2, 30, "Invalid/Zone")).toBeNaN();
  });

  it("falls back to the system time zone without a time zone", () => {
    const date = new TZDate(2022, 2, 13, 2, 30);
    expect(+date).toBe(+new Date(2022, 2, 13, 2, 30));
  });
});

describe("concurrent and repeated construction", () => {
  it("constructs many independent gap dates without shared state", async () => {
    const expected = Date.UTC(2022, 2, 13, 7, 30, 0, 0);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        Promise.resolve().then(() => {
          const date =
            i % 2
              ? new TZDate(2022, 2, 13, 3, 30, 0, 0, NEW_YORK)
              : new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
          return +date;
        }),
      ),
    );
    expect(results.every((value) => value === expected)).toBe(true);
  });

  it("survives process reload semantics (serialization round-trip)", () => {
    const date = new TZDate(2022, 2, 13, 2, 30, 0, 0, NEW_YORK);
    const json = JSON.stringify({ t: +date });
    const restored = new TZDate(JSON.parse(json).t, NEW_YORK);
    expect(restored.toISOString()).toBe("2022-03-13T03:30:00.000-04:00");
  });
});
