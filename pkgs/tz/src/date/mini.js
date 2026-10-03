import { tzOffset } from "../tzOffset/index.ts";

export class TZDateMini extends Date {
  //#region static

  constructor(...args) {
    super();

    if (args.length > 1 && typeof args[args.length - 1] === "string") {
      this.timeZone = args.pop();
    }

    this.internal = new Date();

    if (isNaN(tzOffset(this.timeZone, this))) {
      this.setTime(NaN);
    } else if (!args.length) {
      this.setTime(Date.now());
    } else if (
      typeof args[0] === "number" &&
      (args.length === 1 || (args.length === 2 && typeof args[1] !== "number"))
    ) {
      this.setTime(args[0]);
    } else if (typeof args[0] === "string") {
      this.setTime(+new Date(args[0]));
    } else if (args[0] instanceof Date) {
      this.setTime(+args[0]);
    } else {
      // Year, month, ... components describe the wall-clock time in the
      // target time zone. Resolve the instant purely from the target time
      // zone, without involving the system time zone, so that DST gaps and
      // repeated hours don't produce machine-dependent results.
      this.setTime(instantFromParts(this.timeZone, args));
    }
  }

  static tz(tz, ...args) {
    return args.length
      ? new TZDateMini(...args, tz)
      : new TZDateMini(Date.now(), tz);
  }

  //#endregion

  //#region time zone

  withTimeZone(timeZone) {
    return new TZDateMini(+this, timeZone);
  }

  getTimezoneOffset() {
    const offset = -tzOffset(this.timeZone, this);
    // Remove the seconds offset
    // use Math.floor for negative GMT timezones and Math.ceil for positive GMT timezones.
    return offset > 0 ? Math.floor(offset) : Math.ceil(offset);
  }

  //#endregion

  //#region time

  setTime(_time) {
    Date.prototype.setTime.apply(this, arguments);
    syncToInternal(this);
    return +this;
  }

  //#endregion

  //#region date-fns integration

  [Symbol.for("constructDateFrom")](date) {
    return new TZDateMini(+new Date(date), this.timeZone);
  }

  //#endregion
}

// Assign getters and setters
const re = /^(get|set)(?!UTC)/;
Object.getOwnPropertyNames(Date.prototype).forEach((method) => {
  if (!re.test(method)) return;

  const utcMethod = method.replace(re, "$1UTC");
  // Filter out methods without UTC counterparts
  if (!TZDateMini.prototype[utcMethod]) return;

  if (method.startsWith("get")) {
    // Delegate to internal date's UTC method
    TZDateMini.prototype[method] = function () {
      return this.internal[utcMethod]();
    };
  } else {
    // Assign regular setter
    TZDateMini.prototype[method] = function () {
      Date.prototype[utcMethod].apply(this.internal, arguments);
      syncFromInternal(this);
      return +this;
    };

    // Assign UTC setter
    TZDateMini.prototype[utcMethod] = function () {
      Date.prototype[utcMethod].apply(this, arguments);
      syncToInternal(this);
      return +this;
    };
  }
});

/**
 * Function syncs time to internal date, applying the time zone offset.
 *
 * @param {Date} date - Date to sync
 */
function syncToInternal(date) {
  date.internal.setTime(+date);
  date.internal.setUTCSeconds(
    date.internal.getUTCSeconds() -
      Math.round(-tzOffset(date.timeZone, date) * 60),
  );
}

/**
 * Function syncs the internal date UTC values to the date. The internal date
 * holds the wall-clock components of the target time zone, so its values are
 * resolved to an instant purely from the target time zone, and then the date
 * is set to that instant.
 *
 * @param {Date} date - The date to sync
 */
function syncFromInternal(date) {
  if (isNaN(+date.internal)) {
    Date.prototype.setTime.call(date, NaN);
    return;
  }

  let instant = instantFromParts(date.timeZone, [
    Date.prototype.getUTCFullYear.call(date.internal),
    Date.prototype.getUTCMonth.call(date.internal),
    Date.prototype.getUTCDate.call(date.internal),
    Date.prototype.getUTCHours.call(date.internal),
    Date.prototype.getUTCMinutes.call(date.internal),
    Date.prototype.getUTCSeconds.call(date.internal),
    Date.prototype.getUTCMilliseconds.call(date.internal),
  ]);

  // The internal components are resolved at minute precision, so the offset
  // seconds of historical time zones (e.g. Singapore LMT UTC+06:55:25) shift
  // only the instant, not the wall-clock representation.
  const offset = tzOffset(date.timeZone, new Date(instant));
  const minutes = offset > 0 ? Math.floor(offset) : Math.ceil(offset);
  instant -= Math.round((offset - minutes) * 60) * 1000;

  Date.prototype.setTime.call(date, instant);
  syncToInternal(date);
}

//#region wall-clock helpers

/**
 * Cached time zone offsets. Time zone transitions in the tz database always
 * occur on whole-second boundaries, so the offset is constant within any
 * UTC second; caching per second-aligned bucket never straddles a
 * transition (including historical ones at non-minute-aligned seconds, e.g.
 * Singapore's 1905 LMT end at :35). The per-zone cache is bounded, so a
 * long-running process doesn't accumulate entries indefinitely.
 */
const offsetBuckets = new Map();
const offsetCacheLimit = 4096;

function cachedOffset(timeZone, instant) {
  const bucket = Math.floor(instant / 1000);
  let cache = offsetBuckets.get(timeZone);
  if (!cache) {
    cache = new Map();
    offsetBuckets.set(timeZone, cache);
  }
  let offset = cache.get(bucket);
  if (offset === undefined) {
    if (cache.size >= offsetCacheLimit) cache.clear();
    offset = tzOffset(timeZone, new Date(instant));
    cache.set(bucket, offset);
  }
  return offset;
}

/**
 * Function extracts the wall-clock components of the given instant in the
 * target time zone.
 *
 * @param {string} timeZone - Time zone name (IANA or UTC offset)
 * @param {number} instant - Unix timestamp in milliseconds
 *
 * @returns {{ year: number, month: number, day: number, hours: number, minutes: number, seconds: number, milliseconds: number }}
 */
function wallParts(timeZone, instant) {
  // Shift the instant by the offset and read the components as UTC, which is
  // much cheaper than `Intl.DateTimeFormat`.
  const offset = cachedOffset(timeZone, instant);
  const minuteOffset = offset > 0 ? Math.floor(offset) : Math.ceil(offset);
  const minuteDate = new Date(instant + minuteOffset * 60000);

  // The date components are taken at minute precision, so the offset seconds
  // of historical time zones (e.g. Singapore LMT UTC+06:55:25) don't change
  // the wall-clock date. The wall-clock second, however, includes the offset
  // seconds, so derive it arithmetically from the full-precision shift.
  const shifted = instant + Math.round(offset * 60000);
  const shiftedSeconds = Math.floor(shifted / 1000);

  return {
    year: minuteDate.getUTCFullYear(),
    month: minuteDate.getUTCMonth(),
    day: minuteDate.getUTCDate(),
    hours: minuteDate.getUTCHours(),
    minutes: minuteDate.getUTCMinutes(),
    seconds: ((shiftedSeconds % 60) + 60) % 60,
    milliseconds: ((shifted % 1000) + 1000) % 1000,
  };
}

/**
 * Function resolves the wall-clock components, as accepted by the `Date`
 * constructor, to a Unix timestamp in milliseconds.
 *
 * Unlike the `Date` constructor, it performs all the calculations in the
 * given time zone using `Intl` and `tzOffset`, so the result doesn't depend
 * on the system time zone. It mirrors the `Temporal` "compatible"
 * disambiguation, which matches the `Date` constructor behavior in the
 * system time zone:
 *
 * - In a spring-forward gap (the wall-clock time doesn't exist), the time is
 *   moved forward by the size of the gap.
 * - In a fall-back repeated hour (the wall-clock time occurs twice), the
 *   earlier occurrence (before the transition) is selected.
 *
 * @param {string} timeZone - Time zone name (IANA or UTC offset)
 * @param {Array<number>} args - Year, month, day, hours, minutes, seconds, milliseconds
 *
 * @returns {number} Unix timestamp in milliseconds
 */
function instantFromParts(timeZone, args) {
  // First normalize the components (including overflows) in UTC, as UTC has
  // no DST transitions. The normalized components are the requested
  // wall-clock components in the target time zone.
  const normalized = new Date(Date.UTC(...args));
  if (isNaN(+normalized)) return NaN;

  const target = {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth(),
    day: normalized.getUTCDate(),
    hours: normalized.getUTCHours(),
    minutes: normalized.getUTCMinutes(),
    seconds: normalized.getUTCSeconds(),
    milliseconds: normalized.getUTCMilliseconds(),
  };
  const balanced = +normalized;
  const targetLabel = labelTime(target);

  const candidateFor = (offset) => balanced - Math.round(offset * 60000);

  // The target instant is the balanced instant shifted by one of the time
  // zone offsets around the requested wall-clock time. Start with the offset
  // at the balanced instant and follow the candidate instants to a fixed
  // point: a candidate whose wall-clock time doesn't match the request sits
  // on the wrong side of a transition, and its own offset discovers the
  // other side. This converges in a couple of iterations and makes no extra
  // `Intl` calls for unambiguous wall-clock times.
  const offsets = new Set();
  const candidates = [];
  const pending = [balanced];
  while (pending.length) {
    const instant = pending.pop();
    if (isNaN(instant)) continue;
    const offset = cachedOffset(timeZone, instant);
    if (offsets.has(offset)) continue;
    offsets.add(offset);

    const candidate = candidateFor(offset);
    candidates.push(candidate);
    const parts = wallParts(timeZone, candidate);
    if (!isSameWallTime(parts, target)) pending.push(candidate);
  }

  const matching = [];
  const other = [];
  for (const candidate of candidates) {
    const parts = wallParts(timeZone, candidate);
    if (isSameWallTime(parts, target)) matching.push(candidate);
    else other.push({ instant: candidate, label: labelTime(parts) });
  }

  if (matching.length) {
    // A fall-back repeated hour has two matching occurrences. When the
    // balanced instant lies after the transition, the fixed-point iteration
    // only reaches the later occurrence. Check whether the offset an hour
    // before the match differs (the longest repeated hour is 60 minutes),
    // and only then probe the other side, so ordinary wall-clock times
    // don't pay for extra `Intl` calls.
    let earlier = Math.min(...matching);
    const matchedOffset = cachedOffset(timeZone, earlier);
    if (cachedOffset(timeZone, earlier - 3600000) !== matchedOffset) {
      for (let minutesBack = 30; minutesBack <= 60; minutesBack += 30) {
        const instant = candidateFor(
          cachedOffset(timeZone, earlier - minutesBack * 60000),
        );
        if (
          instant < earlier &&
          isSameWallTime(wallParts(timeZone, instant), target)
        ) {
          earlier = instant;
        }
      }
    }
    return earlier;
  }

  // The wall-clock time doesn't exist (a spring-forward gap). Move the time
  // forward to just after the transition: pick the candidate with the
  // earliest wall-clock label that's not before the requested time.
  let result;
  let resultLabel = Infinity;
  for (const { instant, label } of other) {
    if (label >= targetLabel && label < resultLabel) {
      result = instant;
      resultLabel = label;
    }
  }

  return result ?? Math.max(...candidates);
}

/**
 * @param {{ year: number, month: number, day: number, hours: number, minutes: number, seconds: number, milliseconds: number }} parts
 *
 * @returns {number} Wall-clock label as a Unix timestamp in milliseconds
 */
function labelTime(parts) {
  return Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    parts.hours,
    parts.minutes,
    parts.seconds,
    parts.milliseconds,
  );
}

/**
 * @param {{ year: number, month: number, day: number, hours: number, minutes: number, seconds: number, milliseconds: number }} a
 * @param {{ year: number, month: number, day: number, hours: number, minutes: number, seconds: number, milliseconds: number }} b
 *
 * @returns {boolean}
 */
function isSameWallTime(a, b) {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hours === b.hours &&
    a.minutes === b.minutes &&
    a.seconds === b.seconds &&
    a.milliseconds === b.milliseconds
  );
}

//#endregion
