import { addDays, differenceInDays, format, startOfDay } from "date-fns";
import { UTCDate } from "@date-fns/utc";
import { describe, expect, it } from "vitest";
import { TZDate } from "../../src/index.ts";

describe("mixed TZDate / UTCDate constructors", () => {
  const gapInstant = Date.UTC(2022, 2, 13, 7, 30);

  it("constructs a TZDate from a UTCDate instant", () => {
    const utc = new UTCDate(2022, 2, 13, 7, 30);
    const ny = new TZDate(utc, "America/New_York");
    expect(+ny).toBe(gapInstant);
    expect(ny.toISOString()).toBe("2022-03-13T03:30:00.000-04:00");
  });

  it("constructs a UTCDate from a gap TZDate without shifting", () => {
    const ny = new TZDate(2022, 2, 13, 2, 30, 0, 0, "America/New_York");
    const utc = new UTCDate(+ny);
    expect(utc.toISOString()).toBe("2022-03-13T07:30:00.000Z");
    expect(+utc).toBe(+ny);
  });

  it("date-fns stays in UTCDate context", () => {
    const utc = new UTCDate(2022, 2, 13, 7, 30);
    expect(addDays(utc, 1)).toBeInstanceOf(UTCDate);
    expect(addDays(utc, 1).toISOString()).toBe("2022-03-14T07:30:00.000Z");
    expect(startOfDay(utc).toISOString()).toBe("2022-03-13T00:00:00.000Z");
    expect(format(utc, "yyyy-MM-dd HH:mm")).toBe("2022-03-13 07:30");
  });

  it("date-fns stays in TZDate context built from a UTCDate", () => {
    const utc = new UTCDate(2022, 2, 13, 7, 30);
    const ny = new TZDate(utc, "America/New_York");
    const result = addDays(ny, 1);
    expect(result).toBeInstanceOf(TZDate);
    expect(result.toISOString()).toBe("2022-03-14T03:30:00.000-04:00");
    expect(differenceInDays(addDays(ny, 2), ny)).toBe(2);
  });
});
