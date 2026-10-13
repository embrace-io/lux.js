import { LogEvent, type LogEventRecord } from "../../src/logger";
import { getEventCategory } from "./events";

export type PageViewKind = "navigation" | "init" | "softNavigation" | "bfCacheRestore";

export interface AnalysedEvent {
  record: LogEventRecord;

  /** Position of the event in the original input */
  index: number;

  /** Milliseconds since navigation start */
  time: number;

  /** Running CLS total for the page view, set on layout shift entries */
  cls: number | null;

  /** Warnings to show immediately after this event */
  warnings: string[];
}

export interface PageView {
  kind: PageViewKind;

  /** Milliseconds since navigation start */
  startTime: number;

  /** Milliseconds since navigation start of the first main or POST beacon, if one was sent */
  sendTime: number | null;
  beaconSent: boolean;
  label: string | null;
  hostname: string | null;
  path: string | null;
  events: AnalysedEvent[];
}

export interface Analysis {
  /** Epoch milliseconds */
  navigationStart: number;
  pageViews: PageView[];
  errorCount: number;
  warningCount: number;
}

const MIN_MEASURE_TIME = 1000;

export function parseInput(text: string): LogEventRecord[] {
  if (!text.trim()) {
    throw new Error("Paste the output of LUX.getDebug() to get started.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`The input is not valid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed) || !parsed.every(isLogEventRecord)) {
    throw new Error("The input is not a list of events. Make sure you copied LUX.getDebug().");
  }

  return parsed;
}

function isLogEventRecord(value: unknown): value is LogEventRecord {
  return (
    Array.isArray(value) &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Array.isArray(value[2])
  );
}

export function analyse(events: LogEventRecord[]): Analysis {
  const navigationStart = getNavigationStart(events);
  const analysis: Analysis = {
    navigationStart,
    pageViews: [],
    errorCount: 0,
    warningCount: 0,
  };

  if (!events.length) {
    return analysis;
  }

  let pageView = newPageView("navigation", 0);
  let pendingKind: PageViewKind | null = null;
  let dataCollectionFinished = false;
  let cls = 0;

  analysis.pageViews.push(pageView);

  events.forEach((record, index) => {
    const time = record[0] - navigationStart;
    const args = record[2] as unknown[];
    const kind = pageViewKind(record[1]);

    // LUX.init() and LUX.startSoftNavigation() send the previous page view's beacons before the
    // new page view is set up, so the new page view only starts once lux.js marks LUX_start or
    // initialises a new POST beacon.
    if (kind) {
      pendingKind = kind;
    } else if (record[1] === LogEvent.InitCallIgnored) {
      pendingKind = null;
    } else if (pendingKind && isPageViewStart(record[1], args)) {
      pageView = newPageView(pendingKind, time);
      analysis.pageViews.push(pageView);
      pendingKind = null;
      dataCollectionFinished = false;
      cls = 0;
    }

    const event: AnalysedEvent = { record, index, time, cls: null, warnings: [] };
    pageView.events.push(event);

    if (getEventCategory(record[1]) === "error") {
      analysis.errorCount++;
    }

    switch (record[1]) {
      case LogEvent.MainBeaconSent:
        Object.assign(pageView, describeBeaconUrl(String(args[0])));
        markBeaconSent(pageView, event);
        break;

      case LogEvent.PostBeaconSent:
        markBeaconSent(pageView, event);
        break;

      case LogEvent.DataCollectionStart:
      case LogEvent.PostBeaconStopRecording:
        dataCollectionFinished = true;
        break;

      case LogEvent.PerformanceEntryReceived: {
        const entry = args[0] as { entryType?: string; value?: number };

        if (entry.entryType === "layout-shift" && typeof entry.value === "number") {
          cls += entry.value;
          event.cls = cls;
        }

        // Interaction entries are sent in a supplementary beacon, so they are not lost when
        // they arrive after the main beacon. Only warn once for a run of late entries.
        const next = events[index + 1];

        if (
          dataCollectionFinished &&
          !isInteractionEntry(entry) &&
          (!next || next[1] !== LogEvent.PerformanceEntryReceived)
        ) {
          event.warnings.push(
            "Performance entries were received after the beacon was sent. They will not be included in the beacon.",
          );
        }
        break;
      }
    }

    analysis.warningCount += event.warnings.length;
  });

  return analysis;
}

function getNavigationStart(events: LogEventRecord[]): number {
  for (const event of events) {
    if (event[1] === LogEvent.NavigationStart) {
      return Number((event[2] as unknown[])[0]);
    }
  }

  return events.length ? events[0][0] : 0;
}

function newPageView(kind: PageViewKind, startTime: number): PageView {
  return {
    kind,
    startTime,
    sendTime: null,
    beaconSent: false,
    label: null,
    hostname: null,
    path: null,
    events: [],
  };
}

function pageViewKind(event: LogEvent): PageViewKind | null {
  switch (event) {
    case LogEvent.InitCalled:
      return "init";
    case LogEvent.StartSoftNavigationCalled:
      return "softNavigation";
    case LogEvent.BfCacheRestore:
      return "bfCacheRestore";
  }

  return null;
}

function isInteractionEntry(entry: { entryType?: string }): boolean {
  return entry.entryType === "first-input" || entry.entryType === "event";
}

function isPageViewStart(event: LogEvent, args: unknown[]): boolean {
  return (
    event === LogEvent.PostBeaconInitialised ||
    (event === LogEvent.MarkCalled && args[0] === "LUX_start")
  );
}

function markBeaconSent(pageView: PageView, event: AnalysedEvent) {
  pageView.beaconSent = true;

  if (pageView.sendTime === null) {
    pageView.sendTime = event.time;

    if (event.time - pageView.startTime < MIN_MEASURE_TIME) {
      event.warnings.push(
        "Data was gathered for less than 1 second. Consider increasing the value of LUX.minMeasureTime.",
      );
    }
  }
}

function describeBeaconUrl(url: string): Pick<PageView, "label" | "hostname" | "path"> {
  try {
    const params = new URL(url).searchParams;

    return {
      label: params.get("l"),
      hostname: params.get("HN"),
      path: params.get("PN"),
    };
  } catch {
    return { label: null, hostname: null, path: null };
  }
}
