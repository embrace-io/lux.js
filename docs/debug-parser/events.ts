import { LogEvent, type LogEventRecord } from "../../src/logger";

export type EventCategory =
  | "pageview"
  | "beacon"
  | "error"
  | "warn"
  | "metric"
  | "api"
  | "verbose"
  | "info";

export interface MessageOptions {
  beaconUrl?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function argsAsString(args: any[]): string {
  return args.map((v) => JSON.stringify(v)).join(", ");
}

export function isBeaconEvent(event: LogEvent) {
  return [
    LogEvent.MainBeaconSent,
    LogEvent.CustomDataBeaconSent,
    LogEvent.InteractionBeaconSent,
    LogEvent.UserTimingBeaconSent,
  ].includes(event);
}

export function getEventCategory(event: LogEvent): EventCategory {
  switch (event) {
    case LogEvent.InitCalled:
    case LogEvent.StartSoftNavigationCalled:
    case LogEvent.BfCacheRestore:
      return "pageview";

    case LogEvent.MainBeaconSent:
    case LogEvent.PostBeaconSent:
    case LogEvent.UserTimingBeaconSent:
    case LogEvent.InteractionBeaconSent:
    case LogEvent.CustomDataBeaconSent:
      return "beacon";

    case 0 as LogEvent:
    case LogEvent.PerformanceObserverError:
    case LogEvent.InputEventPermissionError:
    case LogEvent.InnerHtmlAccessError:
    case LogEvent.EventTargetAccessError:
    case LogEvent.CookieReadError:
    case LogEvent.CookieSetError:
    case LogEvent.PageLabelEvaluationError:
    case LogEvent.PostBeaconSendFailed:
    case LogEvent.PostBeaconCSPViolation:
      return "error";

    case LogEvent.SendCancelledPageHidden:
    case LogEvent.SessionIsNotSampled:
    case LogEvent.InitCallIgnored:
    case LogEvent.PostBeaconMetricRejected:
    case LogEvent.NavTimingNotSupported:
    case LogEvent.PaintTimingNotSupported:
      return "warn";

    case LogEvent.PerformanceEntryReceived:
    case LogEvent.PerformanceEntryProcessed:
      return "metric";

    case LogEvent.MarkCalled:
    case LogEvent.MeasureCalled:
    case LogEvent.AddDataCalled:
    case LogEvent.MarkLoadTimeCalled:
    case LogEvent.SendCalled:
    case LogEvent.ForceSampleCalled:
    case LogEvent.TrackingParamAdded:
      return "api";

    case LogEvent.DataCollectionStart:
    case LogEvent.PostBeaconInitialised:
    case LogEvent.PostBeaconSendCalled:
    case LogEvent.PostBeaconTimeoutReached:
    case LogEvent.PostBeaconCancelled:
    case LogEvent.PostBeaconStopRecording:
    case LogEvent.PostBeaconCollector:
      return "verbose";
  }

  return "info";
}

export function getMessageForEvent(event: LogEventRecord, options: MessageOptions = {}): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = event[2] as any[];

  // Fallback message is the raw event name and any arguments
  let message = getEventName(event[1]);

  if (args.length) {
    message += ` (${argsAsString(args)})`;
  }

  const withUrl = (text: string, url: string) => (options.beaconUrl ? `${text}: ${url}` : text);

  switch (event[1]) {
    case 0 as LogEvent:
      return "The lux.js script was not loaded on this page.";

    case LogEvent.EvaluationStart:
      return `lux.js v${args[0]} init begin.`;

    case LogEvent.EvaluationEnd:
      return "lux.js init complete.";

    case LogEvent.InitCalled:
      return "LUX.init() called. This page view ends here.";

    case LogEvent.InitCallIgnored:
      return "LUX.init() was ignored because the page has not finished loading yet.";

    case LogEvent.StartSoftNavigationCalled:
      return "LUX.startSoftNavigation() called. This page view ends here.";

    case LogEvent.BfCacheRestore:
      return "Page was restored from the back/forward cache. This page view ends here.";

    case LogEvent.MarkLoadTimeCalled:
      return `LUX.markLoadTime(${argsAsString(args)})`;

    case LogEvent.MarkCalled:
      return `LUX.mark(${argsAsString(args)})`;

    case LogEvent.MeasureCalled:
      return `LUX.measure(${argsAsString(args)})`;

    case LogEvent.AddDataCalled:
      return `LUX.addData(${argsAsString(args)})`;

    case LogEvent.TrackingParamAdded:
      return `Tracking parameter ${args[0]}=${args[1]} picked up automatically`;

    case LogEvent.SendCalled:
      return "LUX.send()";

    case LogEvent.SendCancelledPageHidden:
      return "This beacon was not sent because the page visibility was hidden.";

    case LogEvent.SendCancelledSpaMode:
      return "LUX.send() was ignored because SPA Mode is enabled.";

    case LogEvent.ForceSampleCalled:
      return "LUX.forceSample()";

    case LogEvent.DataCollectionStart:
      return "Preparing to send main beacon. Metrics received after this point may be ignored.";

    case LogEvent.UnloadHandlerTriggered:
      return "Unload handler was triggered.";

    case LogEvent.OnloadHandlerTriggered:
      message = `Onload handler was triggered after ${args[0]} ms.`;

      if (args[1] > 0) {
        message += ` Minimum measure time was ${args[1]} ms.`;
      }

      return message;

    case LogEvent.SessionIsSampled:
      return `Sample rate is ${args[0]}%. This session is being sampled.`;

    case LogEvent.SessionIsNotSampled:
      return `Sample rate is ${args[0]}%. This session is not being sampled, so no beacons will be sent.`;

    case LogEvent.MainBeaconSent:
      return withUrl("Main beacon sent", args[0]);

    case LogEvent.UserTimingBeaconSent:
      return withUrl("Supplementary user timing beacon sent", args[0]);

    case LogEvent.InteractionBeaconSent:
      return withUrl("Supplementary user interaction beacon sent", args[0]);

    case LogEvent.CustomDataBeaconSent:
      return withUrl("Supplementary custom data beacon sent", args[0]);

    case LogEvent.PostBeaconInitialised:
      return "POST beacon initialised.";

    case LogEvent.PostBeaconSendCalled:
      return "POST beacon send() called.";

    case LogEvent.PostBeaconTimeoutReached:
      return "POST beacon maximum measure timeout reached.";

    case LogEvent.PostBeaconSent:
      return withUrl("POST beacon sent", args[0]);

    case LogEvent.PostBeaconSendFailed:
      return withUrl("POST beacon send failed", args[0]);

    case LogEvent.PostBeaconCancelled:
      return "POST beacon cancelled because it had no metric data.";

    case LogEvent.PostBeaconStopRecording:
      return "POST beacon is no longer recording metrics. Metrics received after this point may be ignored.";

    case LogEvent.PostBeaconMetricRejected:
      return `POST beacon metric rejected: ${args[0]}`;

    case LogEvent.PostBeaconCSPViolation:
      return "POST beacon cancelled due to CSP violation.";

    case LogEvent.PostBeaconCollector:
      return `POST beacon metric collector "${args[0]}" ${args[1] ? "has data" : "has no data"}`;

    case LogEvent.NavigationStart:
      return "";

    case LogEvent.PerformanceEntryReceived:
      return describePerformanceEntry(args[0]);

    case LogEvent.PerformanceEntryProcessed:
      if (args[0].entryType === "largest-contentful-paint") {
        return `Picked LCP from entry at ${args[0].startTime.toFixed()} ms`;
      }

      return `Processed ${args[0].entryType} entry`;

    case LogEvent.PerformanceObserverError:
      return `Error while initialising PerformanceObserver: ${args[0]}`;

    case LogEvent.InputEventPermissionError:
      return "Error reading input event. Cannot calculate FID for this page.";

    case LogEvent.InnerHtmlAccessError:
      return "Cannot read the innerHTML property of an element. Cannot calculate inline style or script sizes for this page.";

    case LogEvent.EventTargetAccessError:
      return "Error reading input event. Cannot calculate user interaction times for this page.";

    case LogEvent.CookieReadError:
      return "Error reading session cookie. This page will not be linked to a user session.";

    case LogEvent.CookieSetError:
      return "Error setting session cookie. This page will not be linked to a user session.";

    case LogEvent.PageLabelEvaluationError:
      return `Error while evaluating '${args[0]}' for the page label: ${args[1]}`;

    case LogEvent.NavTimingNotSupported:
      return "The Navigation Timing API is not supported. Performance metrics for this page will be limited.";

    case LogEvent.PaintTimingNotSupported:
      return "Start render time could not be determined.";
  }

  return message;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describePerformanceEntry(entry: any): string {
  const at = (value: number) => `${Number(value).toFixed()} ms`;

  switch (entry.entryType) {
    case "layout-shift":
      return `Received layout shift at ${at(entry.startTime)} with value of ${entry.value.toFixed(3)}`;

    case "longtask":
      return `Received long task with duration of ${at(entry.duration)}`;

    case "long-animation-frame":
      return `Received long animation frame with duration of ${at(entry.duration)}`;

    case "event":
      if (entry.interactionId === 0) {
        return `Ignored ${entry.name} event entry with no interaction ID`;
      }

      return `Received INP entry for ${entry.name} with duration of ${at(entry.duration)} (ID: ${entry.interactionId})`;

    case "first-input":
      return `Received FID entry for ${entry.name} with duration of ${at(entry.duration)}`;

    case "largest-contentful-paint":
      return `Received LCP entry at ${at(entry.startTime)}`;

    case "element":
      return `Received element timing entry for ${entry.identifier} at ${at(entry.startTime)}`;

    case "paint":
      return `Received ${entry.name} entry at ${at(entry.startTime)}`;
  }

  let message = `Received ${entry.entryType} entry`;

  if (entry.startTime) {
    message += ` at ${at(entry.startTime)}`;
  }

  return message;
}

function getEventName(event: LogEvent) {
  switch (event) {
    case LogEvent.EvaluationStart:
      return "EvaluationStart";
    case LogEvent.EvaluationEnd:
      return "EvaluationEnd";
    case LogEvent.InitCalled:
      return "InitCalled";
    case LogEvent.MarkCalled:
      return "MarkCalled";
    case LogEvent.MeasureCalled:
      return "MeasureCalled";
    case LogEvent.AddDataCalled:
      return "AddDataCalled";
    case LogEvent.SendCalled:
      return "SendCalled";
    case LogEvent.ForceSampleCalled:
      return "ForceSampleCalled";
    case LogEvent.DataCollectionStart:
      return "DataCollectionStart";
    case LogEvent.UnloadHandlerTriggered:
      return "UnloadHandlerTriggered";
    case LogEvent.OnloadHandlerTriggered:
      return "OnloadHandlerTriggered";
    case LogEvent.MarkLoadTimeCalled:
      return "MarkLoadTimeCalled";
    case LogEvent.SendCancelledPageHidden:
      return "SendCancelledPageHidden";
    case LogEvent.StartSoftNavigationCalled:
      return "StartSoftNavigationCalled";
    case LogEvent.SendCancelledSpaMode:
      return "SendCancelledSpaMode";
    case LogEvent.BfCacheRestore:
      return "BfCacheRestore";
    case LogEvent.InitCallIgnored:
      return "InitCallIgnored";
    case LogEvent.SessionIsSampled:
      return "SessionIsSampled";
    case LogEvent.SessionIsNotSampled:
      return "SessionIsNotSampled";
    case LogEvent.MainBeaconSent:
      return "MainBeaconSent";
    case LogEvent.UserTimingBeaconSent:
      return "UserTimingBeaconSent";
    case LogEvent.InteractionBeaconSent:
      return "InteractionBeaconSent";
    case LogEvent.CustomDataBeaconSent:
      return "CustomDataBeaconSent";
    case LogEvent.NavigationStart:
      return "NavigationStart";
    case LogEvent.PerformanceEntryReceived:
      return "PerformanceEntryReceived";
    case LogEvent.PerformanceEntryProcessed:
      return "PerformanceEntryProcessed";
    case LogEvent.TrackingParamAdded:
      return "TrackingParamAdded";
    case LogEvent.PerformanceObserverError:
      return "PerformanceObserverError";
    case LogEvent.InputEventPermissionError:
      return "InputEventPermissionError";
    case LogEvent.InnerHtmlAccessError:
      return "InnerHtmlAccessError";
    case LogEvent.EventTargetAccessError:
      return "EventTargetAccessError";
    case LogEvent.CookieReadError:
      return "CookieReadError";
    case LogEvent.CookieSetError:
      return "CookieSetError";
    case LogEvent.PageLabelEvaluationError:
      return "PageLabelEvaluationError";
    case LogEvent.NavTimingNotSupported:
      return "NavTimingNotSupported";
    case LogEvent.PaintTimingNotSupported:
      return "PaintTimingNotSupported";
    case LogEvent.PostBeaconInitialised:
      return "PostBeaconInitialised";
    case LogEvent.PostBeaconSendCalled:
      return "PostBeaconSendCalled";
    case LogEvent.PostBeaconTimeoutReached:
      return "PostBeaconTimeoutReached";
    case LogEvent.PostBeaconSent:
      return "PostBeaconSent";
    case LogEvent.PostBeaconCancelled:
      return "PostBeaconCancelled";
    case LogEvent.PostBeaconStopRecording:
      return "PostBeaconStopRecording";
    case LogEvent.PostBeaconMetricRejected:
      return "PostBeaconMetricRejected";
    case LogEvent.PostBeaconSendFailed:
      return "PostBeaconSendFailed";
    case LogEvent.PostBeaconCSPViolation:
      return "PostBeaconCSPViolation";
    case LogEvent.PostBeaconCollector:
      return "PostBeaconCollector";
  }

  return `Unknown event ${event}`;
}
