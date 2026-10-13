import { describe, expect, test } from "@jest/globals";
import { analyse, parseInput } from "../../docs/debug-parser/analyse";
import { getEventCategory, getMessageForEvent } from "../../docs/debug-parser/events";
import { isEventVisible } from "../../docs/debug-parser/filters";
import { LogEvent, type LogEventRecord } from "../../src/logger";

const T0 = 1700000000000;

function ev(offset: number, event: LogEvent, args: unknown[] = []): LogEventRecord {
  return [T0 + offset, event, args];
}

function perfEntry(offset: number, entry: Record<string, unknown>): LogEventRecord {
  return ev(offset, LogEvent.PerformanceEntryReceived, [entry]);
}

const layoutShift = (startTime: number, value: number) => ({
  entryType: "layout-shift",
  startTime,
  value,
});

const luxStart = (offset: number) => ev(offset, LogEvent.MarkCalled, ["LUX_start"]);

describe("parseInput", () => {
  test("parses an array of events", () => {
    expect(parseInput(JSON.stringify([ev(0, LogEvent.EvaluationStart, ["4.5.3"])]))).toHaveLength(
      1,
    );
  });

  test("rejects empty input", () => {
    expect(() => parseInput("")).toThrow(/paste/i);
    expect(() => parseInput("   ")).toThrow(/paste/i);
  });

  test("rejects invalid JSON", () => {
    expect(() => parseInput("not json")).toThrow(/valid JSON/i);
  });

  test("rejects JSON that is not a list of events", () => {
    expect(() => parseInput("{}")).toThrow(/list of events/i);
    expect(() => parseInput("[1, 2]")).toThrow(/list of events/i);
  });
});

describe("analyse", () => {
  test("uses the NavigationStart event as the time origin", () => {
    const result = analyse([
      ev(10, LogEvent.EvaluationStart, ["4.5.3", "{}"]),
      ev(11, LogEvent.NavigationStart, [T0]),
      ev(150, LogEvent.MainBeaconSent, ["http://beacon/?l=Home&PN=%2Fhome&HN=example.com"]),
    ]);

    expect(result.navigationStart).toEqual(T0);
    expect(result.pageViews).toHaveLength(1);
    expect(result.pageViews[0].events.map((e) => e.time)).toEqual([10, 11, 150]);
  });

  test("falls back to the first event timestamp when there is no NavigationStart event", () => {
    const result = analyse([ev(5, LogEvent.EvaluationStart, ["4.5.3", "{}"])]);

    expect(result.navigationStart).toEqual(T0 + 5);
    expect(result.pageViews[0].events[0].time).toEqual(0);
  });

  test("splits events into page views on init and soft navigation", () => {
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      ev(100, LogEvent.MainBeaconSent, ["http://beacon/?l=First"]),
      ev(2000, LogEvent.InitCalled),
      luxStart(2001),
      ev(3500, LogEvent.MainBeaconSent, ["http://beacon/?l=Second"]),
      ev(4000, LogEvent.StartSoftNavigationCalled),
      luxStart(4001),
      ev(5500, LogEvent.MainBeaconSent, ["http://beacon/?l=Third"]),
    ]);

    expect(result.pageViews.map((pv) => pv.kind)).toEqual(["navigation", "init", "softNavigation"]);
    expect(result.pageViews.map((pv) => pv.label)).toEqual(["First", "Second", "Third"]);
    expect(result.pageViews.map((pv) => pv.startTime)).toEqual([0, 2001, 4001]);
    expect(result.pageViews.map((pv) => pv.events.length)).toEqual([3, 3, 2]);
  });

  test("keeps beacons sent by LUX.init() in the page view they belong to", () => {
    // In SPA mode, LUX.init() sends the previous page view's beacons before marking LUX_start
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      ev(6500, LogEvent.InitCalled),
      ev(6500, LogEvent.PostBeaconSendCalled),
      ev(6501, LogEvent.PostBeaconSent, ["http://beacon/", {}]),
      ev(6501, LogEvent.DataCollectionStart),
      ev(6503, LogEvent.MainBeaconSent, ["http://beacon/?l=First"]),
      ev(6503, LogEvent.UserTimingBeaconSent, ["http://beacon/?l=First"]),
      luxStart(6504),
      ev(6504, LogEvent.PostBeaconInitialised),
      ev(9000, LogEvent.UnloadHandlerTriggered),
      ev(9000, LogEvent.MainBeaconSent, ["http://beacon/?l=Second"]),
    ]);

    expect(result.pageViews).toHaveLength(2);

    const [first, second] = result.pageViews;

    expect(first.events).toHaveLength(7);
    expect(first.label).toEqual("First");
    expect(first.sendTime).toEqual(6501);
    expect(first.events[6].warnings).toEqual([]);

    expect(second.kind).toEqual("init");
    expect(second.startTime).toEqual(6504);
    expect(second.events).toHaveLength(4);
    expect(second.label).toEqual("Second");
    expect(second.sendTime).toEqual(9000);
  });

  test("starts the new page view at the POST beacon initialisation when there is no LUX_start mark", () => {
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      ev(2000, LogEvent.StartSoftNavigationCalled),
      ev(2001, LogEvent.PostBeaconInitialised),
      ev(2002, LogEvent.EvaluationEnd),
    ]);

    expect(result.pageViews.map((pv) => pv.events.length)).toEqual([2, 2]);
    expect(result.pageViews[1].kind).toEqual("softNavigation");
  });

  test("does not start a new page view when LUX.init() is ignored", () => {
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      ev(500, LogEvent.InitCalled),
      ev(500, LogEvent.InitCallIgnored),
      ev(1000, LogEvent.MarkCalled, ["LUX_start"]),
      ev(1500, LogEvent.PostBeaconInitialised),
    ]);

    expect(result.pageViews).toHaveLength(1);
  });

  test("reads the label, hostname and path from the main beacon", () => {
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      ev(100, LogEvent.MainBeaconSent, ["http://beacon/?l=Home%20Page&PN=%2Fhome&HN=example.com"]),
    ]);

    expect(result.pageViews[0].label).toEqual("Home Page");
    expect(result.pageViews[0].hostname).toEqual("example.com");
    expect(result.pageViews[0].path).toEqual("/home");
  });

  test("records whether a beacon was sent for each page view", () => {
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      ev(100, LogEvent.PostBeaconSent, ["http://beacon/", {}]),
      ev(2000, LogEvent.InitCalled),
      luxStart(2001),
      ev(2100, LogEvent.SendCalled),
      ev(2100, LogEvent.SendCancelledPageHidden),
    ]);

    expect(result.pageViews[0].beaconSent).toBe(true);
    expect(result.pageViews[0].sendTime).toEqual(100);
    expect(result.pageViews[1].beaconSent).toBe(false);
    expect(result.pageViews[1].sendTime).toBeNull();
  });

  test("warns when a beacon was sent less than one second after the page view started", () => {
    const beacon = (offset: number) => ev(offset, LogEvent.MainBeaconSent, ["http://beacon/"]);
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      beacon(1500),
      ev(2000, LogEvent.InitCalled),
      luxStart(2001),
      beacon(2400),
      ev(3000, LogEvent.StartSoftNavigationCalled),
      luxStart(3001),
      ev(3200, LogEvent.PostBeaconSent, ["http://beacon/", {}]),
      beacon(3201),
    ]);

    const [first, second, third] = result.pageViews;

    expect(first.events[1].warnings).toEqual([]);
    expect(second.events[1].warnings).toEqual([expect.stringMatching(/less than 1 second/)]);
    expect(third.events[1].warnings).toEqual([expect.stringMatching(/less than 1 second/)]);
    expect(third.events[2].warnings).toEqual([]);
    expect(result.warningCount).toEqual(2);
  });

  test("warns once for a run of performance entries received after data collection finished", () => {
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      perfEntry(100, layoutShift(100, 0.01)),
      ev(1500, LogEvent.DataCollectionStart),
      ev(1510, LogEvent.MainBeaconSent, ["http://beacon/"]),
      perfEntry(1600, layoutShift(1600, 0.01)),
      perfEntry(1700, layoutShift(1700, 0.01)),
    ]);

    const warnings = result.pageViews[0].events.map((e) => e.warnings.length);

    expect(warnings).toEqual([0, 0, 0, 0, 0, 1]);
    expect(result.pageViews[0].events[5].warnings[0]).toMatch(/after the beacon was sent/);
  });

  test("does not warn about interaction entries received after the beacon was sent", () => {
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      ev(1500, LogEvent.DataCollectionStart),
      ev(1510, LogEvent.MainBeaconSent, ["http://beacon/"]),
      perfEntry(1600, { entryType: "first-input", name: "pointerdown", duration: 8 }),
      perfEntry(1700, { entryType: "event", name: "click", duration: 24, interactionId: 1 }),
      perfEntry(1800, layoutShift(1800, 0.01)),
    ]);

    const warnings = result.pageViews[0].events.map((e) => e.warnings.length);

    expect(warnings).toEqual([0, 0, 0, 0, 0, 1]);
  });

  test("resets the data collection state for each page view", () => {
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      ev(1500, LogEvent.DataCollectionStart),
      ev(2000, LogEvent.InitCalled),
      luxStart(2001),
      perfEntry(2100, layoutShift(2100, 0.01)),
    ]);

    expect(result.pageViews[1].events[1].warnings).toEqual([]);
  });

  test("tracks a running CLS total per page view", () => {
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      perfEntry(100, layoutShift(100, 0.01)),
      perfEntry(200, layoutShift(200, 0.02)),
      ev(2000, LogEvent.InitCalled),
      luxStart(2001),
      perfEntry(2100, layoutShift(2100, 0.05)),
    ]);

    expect(result.pageViews[0].events[1].cls).toBeCloseTo(0.01);
    expect(result.pageViews[0].events[2].cls).toBeCloseTo(0.03);
    expect(result.pageViews[1].events[1].cls).toBeCloseTo(0.05);
  });

  test("counts errors", () => {
    const result = analyse([
      ev(0, LogEvent.NavigationStart, [T0]),
      ev(10, LogEvent.CookieReadError),
      ev(20, LogEvent.PostBeaconSendFailed, ["http://beacon/", {}]),
    ]);

    expect(result.errorCount).toEqual(2);
  });
});

describe("getMessageForEvent", () => {
  test("describes every known event without falling back to the raw name", () => {
    expect(getMessageForEvent(ev(0, LogEvent.InitCallIgnored))).toMatch(/ignored/i);
    expect(getMessageForEvent(ev(0, LogEvent.BfCacheRestore))).toMatch(/back\/forward cache/i);
  });

  test("includes the duration of long animation frames", () => {
    const message = getMessageForEvent(
      perfEntry(0, { entryType: "long-animation-frame", startTime: 10, duration: 135.9 }),
    );

    expect(message).toMatch(/long animation frame with duration of 136 ms/);
  });

  test("includes the interaction type for INP entries", () => {
    const message = getMessageForEvent(
      perfEntry(0, {
        entryType: "event",
        name: "pointerdown",
        startTime: 10,
        duration: 48,
        interactionId: 7,
      }),
    );

    expect(message).toMatch(/pointerdown/);
    expect(message).toMatch(/48 ms/);
  });

  test("only includes the beacon URL when asked", () => {
    const event = ev(0, LogEvent.MainBeaconSent, ["http://beacon/?l=Home"]);

    expect(getMessageForEvent(event)).not.toMatch(/http/);
    expect(getMessageForEvent(event, { beaconUrl: true })).toMatch(/http:\/\/beacon/);
  });
});

describe("getEventCategory", () => {
  test("categorises events", () => {
    expect(getEventCategory(LogEvent.InitCalled)).toEqual("pageview");
    expect(getEventCategory(LogEvent.MainBeaconSent)).toEqual("beacon");
    expect(getEventCategory(LogEvent.PostBeaconSent)).toEqual("beacon");
    expect(getEventCategory(LogEvent.CookieReadError)).toEqual("error");
    expect(getEventCategory(LogEvent.PostBeaconSendFailed)).toEqual("error");
    expect(getEventCategory(LogEvent.SessionIsNotSampled)).toEqual("warn");
    expect(getEventCategory(LogEvent.PerformanceEntryReceived)).toEqual("metric");
    expect(getEventCategory(LogEvent.AddDataCalled)).toEqual("api");
    expect(getEventCategory(LogEvent.PostBeaconCollector)).toEqual("verbose");
    expect(getEventCategory(LogEvent.DataCollectionStart)).toEqual("verbose");
    expect(getEventCategory(LogEvent.EvaluationEnd)).toEqual("info");
  });
});

describe("isEventVisible", () => {
  const all = ["metrics", "addData", "userTiming", "verbose"];

  test("hides metric events unless the metrics filter is on", () => {
    const event = perfEntry(0, layoutShift(0, 0.01));

    expect(isEventVisible(event, all)).toBe(true);
    expect(isEventVisible(event, ["addData"])).toBe(false);
  });

  test("hides verbose events unless the verbose filter is on", () => {
    expect(isEventVisible(ev(0, LogEvent.PostBeaconCollector, ["cls", true]), ["metrics"])).toBe(
      false,
    );
    expect(isEventVisible(ev(0, LogEvent.PostBeaconCollector, ["cls", true]), ["verbose"])).toBe(
      true,
    );
  });

  test("hides addData and user timing calls according to their filters", () => {
    expect(isEventVisible(ev(0, LogEvent.AddDataCalled, ["a", "b"]), [])).toBe(false);
    expect(isEventVisible(ev(0, LogEvent.AddDataCalled, ["a", "b"]), ["addData"])).toBe(true);
    expect(isEventVisible(ev(0, LogEvent.MarkCalled, ["m"]), [])).toBe(false);
    expect(isEventVisible(ev(0, LogEvent.MeasureCalled, ["m"]), ["userTiming"])).toBe(true);
  });

  test("never hides the NavigationStart event's absence, page views, beacons or errors", () => {
    expect(isEventVisible(ev(0, LogEvent.InitCalled), [])).toBe(true);
    expect(isEventVisible(ev(0, LogEvent.MainBeaconSent, ["http://beacon/"]), [])).toBe(true);
    expect(isEventVisible(ev(0, LogEvent.CookieReadError), [])).toBe(true);
  });

  test("NavigationStart is never rendered as a row", () => {
    expect(isEventVisible(ev(0, LogEvent.NavigationStart, [T0]), all)).toBe(false);
  });
});
