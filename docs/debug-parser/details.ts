import Flags, { hasFlag } from "../../src/flags";
import { getNavTiming } from "../../tests/helpers/lux";

type Row = [label: string, value: string | number | null | undefined];

const FLAG_NAMES: [number, string][] = [
  [Flags.InitCalled, "InitCalled"],
  [Flags.NavTimingNotSupported, "NavTimingNotSupported"],
  [Flags.UserTimingNotSupported, "UserTimingNotSupported"],
  [Flags.VisibilityStateNotVisible, "VisibilityStateNotVisible"],
  [Flags.BeaconSentFromUnloadHandler, "BeaconSentFromUnloadHandler"],
  [Flags.BeaconSentAfterTimeout, "BeaconSentAfterTimeout"],
  [Flags.PageLabelFromDocumentTitle, "PageLabelFromDocumentTitle"],
  [Flags.PageLabelFromLabelProp, "PageLabelFromLabelProp"],
  [Flags.PageLabelFromGlobalVariable, "PageLabelFromGlobalVariable"],
  [Flags.PageLabelFromUrlPattern, "PageLabelFromUrlPattern"],
  [Flags.PageWasPrerendered, "PageWasPrerendered"],
  [Flags.PageWasBfCacheRestored, "PageWasBfCacheRestored"],
  [Flags.BeaconBlockedByCsp, "BeaconBlockedByCsp"],
];

export function describeFlags(flags: number): string {
  const names = FLAG_NAMES.filter(([flag]) => hasFlag(flags, flag)).map(([, name]) => name);

  return names.length ? `${flags} (${names.join(", ")})` : String(flags);
}

export function buildDetails(summaryText: string, ...children: Node[]): HTMLDetailsElement {
  const details = document.createElement("details");
  const summary = document.createElement("summary");

  details.className = "event-details";
  summary.textContent = summaryText;
  details.append(summary, ...children);

  return details;
}

export function buildMainBeaconDetails(url: string): HTMLDetailsElement {
  let beaconUrl: URL;

  try {
    beaconUrl = new URL(url);
  } catch {
    return buildDetails("Beacon details", pre(url));
  }

  const params = beaconUrl.searchParams;
  const NT = getNavTiming(beaconUrl);

  return buildDetails(
    "Beacon details",
    definitionList([
      ["Page label", params.get("l")],
      ["Hostname", params.get("HN")],
      ["Path", params.get("PN")],
      ["lux.js version", params.get("v")],
      ["Flags", params.has("fl") ? describeFlags(Number(params.get("fl"))) : null],
      ["LCP", NT.largestContentfulPaint],
      ["CLS", params.get("DCLS")],
      ["INP", params.get("INP")],
      ["FID", params.get("FID")],
    ]),
    pre(url),
  );
}

export function buildPostBeaconDetails(url: string, payload: unknown): HTMLDetailsElement {
  const data = parseJson(payload) as Record<string, unknown> | null;

  if (!data || typeof data !== "object") {
    return buildDetails("Beacon details", pre(String(payload)));
  }

  const metricKeys = ["nt", "fcp", "lcp", "cls", "inp", "loaf", "rage"].filter(
    (key) => key in data,
  );
  const metricValue = (key: string) => {
    const metric = data[key] as { value?: number } | undefined;

    return metric && typeof metric.value === "number" ? metric.value : null;
  };

  return buildDetails(
    "Beacon details",
    definitionList([
      ["Endpoint", url],
      ["Page ID", data.pageId as string],
      ["Session ID", data.sessionId as string],
      ["lux.js version", data.scriptVersion as string],
      ["Snippet version", data.snippetVersion as string],
      ["Flags", typeof data.flags === "number" ? describeFlags(data.flags) : null],
      ["Measure duration", formatMs(data.measureDuration)],
      ["Collection duration", formatMs(data.collectionDuration)],
      ["Metrics included", metricKeys.length ? metricKeys.join(", ") : "none"],
      ["FCP", formatMs(metricValue("fcp"))],
      ["LCP", formatMs(metricValue("lcp"))],
      ["CLS", formatCls(metricValue("cls"))],
      ["INP", formatMs(metricValue("inp"))],
    ]),
    pre(JSON.stringify(data, null, 2)),
  );
}

export function buildConfigDetails(config: unknown): HTMLDetailsElement {
  const data = parseJson(config);

  return buildDetails(
    "Configuration",
    pre(typeof data === "string" ? data : JSON.stringify(data, null, 2)),
  );
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatCls(value: number | null): string | null {
  return value === null ? null : value.toFixed(3);
}

function formatMs(value: unknown): string | null {
  return typeof value === "number" ? `${new Intl.NumberFormat().format(value)} ms` : null;
}

function definitionList(rows: Row[]): HTMLDListElement {
  const dl = document.createElement("dl");

  dl.className = "details-list";

  for (const [label, value] of rows) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    const dt = document.createElement("dt");
    const dd = document.createElement("dd");

    dt.textContent = label;
    dd.textContent = String(value);
    dl.append(dt, dd);
  }

  return dl;
}

function pre(text: string): HTMLPreElement {
  const el = document.createElement("pre");

  el.textContent = text;

  return el;
}
