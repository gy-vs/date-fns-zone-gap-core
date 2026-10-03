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
    } else {
      if (!args.length) {
        this.setTime(Date.now());
      } else if (
        typeof args[0] === "number" &&
        (args.length === 1 ||
          (args.length === 2 && typeof args[1] !== "number"))
      ) {
        this.setTime(args[0]);
      } else if (typeof args[0] === "string") {
        this.setTime(+new Date(args[0]));
      } else if (args[0] instanceof Date) {
        this.setTime(+args[0]);
      } else {
        // Date components are wall-clock values in the target time zone.
        // Resolve them directly against the zone instead of going through the
        // system time zone, whose own DST transitions used to skew the result.
        syncFromWallTime(this, Date.UTC(...args));
      }
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
 * Function syncs the internal date UTC values to the date. It allows to get
 * accurate timestamp value.
 *
 * @param {Date} date - The date to sync
 */
function syncFromInternal(date) {
  // The internal date keeps the wall-clock components of the target time zone
  // in its UTC fields. Historical offsets may carry sub-minute seconds
  // (e.g. Asia/Singapore +06:55:25 in 1900); align the wall components to the
  // whole-minute offset before resolving. Only the target zone is consulted,
  // so system-zone seconds never leak in. `syncToInternal` restores the
  // seconds on the internal representation afterwards.
  const seconds = Math.round(-tzOffset(date.timeZone, date.internal) * 60) % 60;
  syncFromWallTime(date, +date.internal + seconds * 1000);
}

/**
 * Resolve wall-clock components into a timestamp and sync both the date and
 * its internal representation.
 *
 * @param {Date} date - The TZDate instance to sync
 * @param {number} utcWall - Wall-clock components as a UTC timestamp
 */
function syncFromWallTime(date, utcWall) {
  Date.prototype.setTime.call(date, resolveWallTime(date.timeZone, utcWall));
  syncToInternal(date);
}

/**
 * Resolve wall-clock components of a time zone to a UTC timestamp.
 *
 * The wall time is passed as a UTC timestamp (`utcWall`) carrying the same
 * calendar components as the wall time (e.g. 02:30 in America/New_York is
 * passed as `Date.UTC(year, month, day, 2, 30)`).
 *
 * Resolution follows the native `Date` rules:
 *
 * - an unambiguous wall time maps to its unique instant;
 * - a spring-forward gap (a missing local time) is forward-shifted past the
 *   gap (New York 02:30 -> 03:30). The resulting instant is obtained with the
 *   pre-transition offset, which lands on the post-transition wall clock;
 * - a fall-back overlap (a repeated local time) resolves to the first
 *   occurrence (the earlier instant, on the pre-transition side).
 *
 * @param {string | undefined} timeZone - IANA time zone name
 * @param {number} utcWall - Wall-clock components as a UTC timestamp
 *
 * @returns {number} Resolved UTC timestamp in milliseconds
 */
function resolveWallTime(timeZone, utcWall) {
  if (isNaN(utcWall)) return NaN;

  // Primary candidate: interpret the wall time with the offset (whole minutes)
  // Intl reports at the nominal instant. For ordinary times this is the
  // answer. Intl resolves fall-back overlaps to the second occurrence and
  // spring-forward gaps to the post-transition side, so the ambiguous cases
  // need the checks below. Sub-minute offset seconds are handled by callers.
  const off0 = tzOffset(timeZone, new Date(utcWall));
  const t0 = utcWall - off0 * 60000;

  // Probe both sides of the candidate to discover the neighbouring offset
  // regime. Three hours safely straddles a single DST transition (gaps and
  // overlaps last at most one hour) without reaching another transition.
  // Collecting each side separately matters right next to a transition
  // (e.g. :45 zones such as Pacific/Chatham).
  const PROBE = 3 * 60 * 60000;
  const offBefore = tzOffset(timeZone, new Date(t0 - PROBE));
  const offAfter = tzOffset(timeZone, new Date(t0 + PROBE));

  const candidates = [t0];
  if (offBefore !== off0) candidates.push(utcWall - offBefore * 60000);
  if (offAfter !== off0) candidates.push(utcWall - offAfter * 60000);

  // Keep candidates whose instant actually displays the requested wall time.
  const matching = candidates.filter((candidate) =>
    wallMatches(timeZone, candidate, utcWall),
  );

  if (matching.length) {
    // An overlap yields two matching instants (take the earlier/first one);
    // otherwise the unique match is the answer.
    return matching.length > 1 ? Math.min(...matching) : matching[0];
  }

  // No candidate reproduces the wall time: spring-forward gap. Native Date
  // forward-shifts the wall time by the size of the jump, which is the instant
  // obtained with the pre-transition offset (New York 02:30 after a one-hour
  // jump lands on the 03:30 instant; works for :30/:45 zones too).
  if (offBefore !== offAfter) {
    return utcWall - Math.min(offBefore, offAfter) * 60000;
  }
  return t0;
}

/**
 * Check whether the given instant displays the same wall-clock components in
 * the time zone as `utcWall` carries as UTC.
 *
 * @param {string | undefined} timeZone - IANA time zone name
 * @param {number} instant - UTC timestamp in milliseconds
 * @param {number} utcWall - Expected wall-clock components as a UTC timestamp
 *
 * @returns {boolean} True when the components match
 */
function wallMatches(timeZone, instant, utcWall) {
  const local = new Date(
    instant + tzOffset(timeZone, new Date(instant)) * 60000,
  );
  const wall = new Date(utcWall);
  return (
    local.getUTCFullYear() === wall.getUTCFullYear() &&
    local.getUTCMonth() === wall.getUTCMonth() &&
    local.getUTCDate() === wall.getUTCDate() &&
    local.getUTCHours() === wall.getUTCHours() &&
    local.getUTCMinutes() === wall.getUTCMinutes() &&
    local.getUTCSeconds() === wall.getUTCSeconds() &&
    local.getUTCMilliseconds() === wall.getUTCMilliseconds()
  );
}
