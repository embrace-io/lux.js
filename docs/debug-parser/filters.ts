import { LogEvent, type LogEventRecord } from "../../src/logger";
import { getEventCategory } from "./events";

export function getFilters(filterInputs: NodeListOf<HTMLInputElement>): string[] {
  const filters: string[] = [];

  filterInputs.forEach((filterEl) => {
    const event = filterEl.getAttribute("data-event");

    if (filterEl.checked && event) {
      filters.push(event);
    }
  });

  return filters;
}

export function isEventVisible(event: LogEventRecord, filters: string[]): boolean {
  switch (event[1]) {
    case LogEvent.NavigationStart:
      return false;

    case LogEvent.AddDataCalled:
      return filters.includes("addData");

    case LogEvent.MarkCalled:
    case LogEvent.MeasureCalled:
      return filters.includes("userTiming");
  }

  switch (getEventCategory(event[1])) {
    case "metric":
      return filters.includes("metrics");

    case "verbose":
      return filters.includes("verbose");
  }

  return true;
}
