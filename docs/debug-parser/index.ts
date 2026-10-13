import { LogEvent, type LogEventRecord } from "../../src/logger";
import { analyse, parseInput, type Analysis, type PageView } from "./analyse";
import { buildConfigDetails, buildMainBeaconDetails, buildPostBeaconDetails } from "./details";
import { getEventCategory, getMessageForEvent } from "./events";
import { getFilters, isEventVisible } from "./filters";

const STORAGE_KEY = "lux-debug-parser-input";
const THEME_KEY = "lux-debug-parser-theme";

const input = query<HTMLTextAreaElement>("#input");
const inputSection = query<HTMLDetailsElement>("#input-section");
const inputSummary = query<HTMLElement>("#input-summary");
const parseBtn = query<HTMLButtonElement>("#parse");
const clearBtn = query<HTMLButtonElement>("#clear");
const copyBtn = query<HTMLButtonElement>("#copy");
const errorEl = query<HTMLElement>("#error");
const results = query<HTMLElement>("#results");
const summary = query<HTMLElement>("#summary");
const search = query<HTMLInputElement>("#search");
const output = query<HTMLElement>("#output");
const filterInputs = document.querySelectorAll<HTMLInputElement>(".event-filter");
const themeSelect = query<HTMLSelectElement>("#theme");

let analysis: Analysis | null = null;
let parseTimeout: ReturnType<typeof setTimeout> | undefined;

parseBtn.addEventListener("click", () => parse());
clearBtn.addEventListener("click", () => {
  input.value = "";
  saveInput();
  parse();
  input.focus();
});
copyBtn.addEventListener("click", copyAsText);
search.addEventListener("input", applySearch);
filterInputs.forEach((el) => el.addEventListener("change", render));

input.addEventListener("input", () => {
  saveInput();
  clearTimeout(parseTimeout);
  parseTimeout = setTimeout(parse, 300);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    parse();
  }
});

themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
applyTheme(readStorage(THEME_KEY));
restoreInput();

if (input.value) {
  parse();
}

function parse() {
  let events: LogEventRecord[];

  try {
    events = parseInput(input.value);
  } catch (err) {
    analysis = null;
    showError(input.value.trim() ? (err as Error).message : "");
    render();
    return;
  }

  analysis = analyse(events);
  showError("");
  inputSection.open = false;
  render();
}

function render() {
  output.innerHTML = "";

  if (!analysis) {
    results.hidden = true;
    inputSummary.textContent = "";
    return;
  }

  const eventCount = analysis.pageViews.reduce((n, pv) => n + pv.events.length, 0);
  const filters = getFilters(filterInputs);
  const showBeaconUrl = filters.includes("beaconUrl");

  results.hidden = false;
  inputSummary.textContent = `${plural(eventCount, "event")} pasted`;
  renderSummary(analysis, eventCount);

  analysis.pageViews.forEach((pageView, i) => {
    output.appendChild(renderPageView(pageView, i, filters, showBeaconUrl));
  });

  applySearch();
}

function renderSummary(analysis: Analysis, eventCount: number) {
  summary.innerHTML = "";

  const started = new Date(analysis.navigationStart);
  const beaconsSent = analysis.pageViews.filter((pv) => pv.beaconSent).length;

  const parts: [string, string][] = [
    ["", plural(eventCount, "event")],
    ["", plural(analysis.pageViews.length, "page view")],
    ["", `${beaconsSent} with beacons`],
    ["summary-warn", plural(analysis.warningCount, "warning")],
    ["summary-error", plural(analysis.errorCount, "error")],
    ["summary-muted", `Started ${started.toLocaleDateString()} ${started.toLocaleTimeString()}`],
  ];

  for (const [className, text] of parts) {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    summary.appendChild(el);
  }
}

function renderPageView(
  pageView: PageView,
  index: number,
  filters: string[],
  showBeaconUrl: boolean,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "page-view";
  section.dataset.heading = `Page view ${index + 1} (${describeKind(pageView)})`;

  const header = document.createElement("header");
  header.className = "page-view-header";

  const heading = document.createElement("h2");
  heading.textContent = `Page view ${index + 1}`;

  const kind = document.createElement("span");
  kind.className = "badge";
  kind.textContent = describeKind(pageView);
  heading.appendChild(kind);

  const status = document.createElement("span");
  status.className = pageView.beaconSent ? "status status-sent" : "status status-unsent";
  status.textContent = pageView.beaconSent
    ? `Beacon sent at ${formatMs(pageView.sendTime!)}`
    : "No beacon sent";

  const meta = document.createElement("dl");
  meta.className = "page-view-meta";
  const metaRows: [string, string | null][] = [
    ["Label", pageView.label],
    ["Host", pageView.hostname],
    ["Path", pageView.path],
    ["Started", formatMs(pageView.startTime)],
    [
      "Measured",
      pageView.sendTime !== null ? formatMs(pageView.sendTime - pageView.startTime) : null,
    ],
  ];

  for (const [label, value] of metaRows) {
    if (value === null) {
      continue;
    }

    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    meta.append(dt, dd);
  }

  header.append(heading, status, meta);
  section.appendChild(header);

  const list = document.createElement("ol");
  list.className = "events";

  let lastTime: number | null = null;

  for (const event of pageView.events) {
    const record = event.record;

    if (!isEventVisible(record, filters)) {
      continue;
    }

    const message = getMessageForEvent(record, { beaconUrl: showBeaconUrl });
    const row = renderEventRow(event.time, lastTime, message, getEventCategory(record[1]));
    const details = renderEventDetails(record);

    if (details) {
      row.querySelector(".event-body")!.appendChild(details);
    }

    if (event.cls !== null) {
      const cls = document.createElement("span");
      cls.className = "event-note";
      cls.textContent = `CLS so far: ${event.cls.toFixed(3)}`;
      row.querySelector(".event-body")!.appendChild(cls);
    }

    list.appendChild(row);
    lastTime = event.time;

    for (const warning of event.warnings) {
      list.appendChild(renderEventRow(event.time, event.time, warning, "warn", true));
    }
  }

  if (!list.children.length) {
    const empty = document.createElement("li");
    empty.className = "events-empty";
    empty.textContent = "No events match the current filters.";
    list.appendChild(empty);
  }

  section.appendChild(list);

  return section;
}

function renderEventRow(
  time: number,
  lastTime: number | null,
  message: string,
  category: string,
  isWarning = false,
): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `event event-${category}${isWarning ? " event-warning-row" : ""}`;
  li.dataset.text = `${formatMs(time)}  ${message}`;

  const timeEl = document.createElement("span");
  timeEl.className = "event-time";
  timeEl.textContent = formatMs(time);

  const deltaEl = document.createElement("span");
  deltaEl.className = "event-delta";

  if (lastTime !== null && !isWarning) {
    const delta = time - lastTime;
    deltaEl.textContent = delta > 0 ? `+${new Intl.NumberFormat().format(delta)}` : "";

    if (delta >= 1000) {
      deltaEl.classList.add("event-delta-large");
    }
  }

  const body = document.createElement("div");
  body.className = "event-body";

  const messageEl = document.createElement("span");
  messageEl.className = "event-message";
  messageEl.textContent = message;
  body.appendChild(messageEl);

  li.append(timeEl, deltaEl, body);

  return li;
}

function renderEventDetails(record: LogEventRecord): HTMLElement | null {
  const args = record[2] as unknown[];

  switch (record[1]) {
    case LogEvent.EvaluationStart:
      return args.length > 1 ? buildConfigDetails(args[1]) : null;

    case LogEvent.MainBeaconSent:
      return buildMainBeaconDetails(String(args[0]));

    case LogEvent.PostBeaconSent:
    case LogEvent.PostBeaconSendFailed:
      return buildPostBeaconDetails(String(args[0]), args[1]);
  }

  return null;
}

function describeKind(pageView: PageView): string {
  switch (pageView.kind) {
    case "navigation":
      return "Navigation";
    case "init":
      return "LUX.init()";
    case "softNavigation":
      return "Soft navigation";
    case "bfCacheRestore":
      return "Back/forward cache";
  }
}

function applySearch() {
  const term = search.value.trim().toLowerCase();
  const rows = output.querySelectorAll<HTMLLIElement>(".event");

  rows.forEach((row) => {
    row.hidden = term !== "" && !(row.dataset.text || "").toLowerCase().includes(term);
  });
}

function copyAsText() {
  const lines: string[] = [];

  output.querySelectorAll<HTMLElement>(".page-view").forEach((section) => {
    const heading = section.dataset.heading;
    const status = section.querySelector(".status")!.textContent;
    const meta: string[] = [];

    section.querySelectorAll(".page-view-meta dt").forEach((dt) => {
      meta.push(`${dt.textContent}: ${dt.nextElementSibling!.textContent}`);
    });

    if (lines.length) {
      lines.push("");
    }

    lines.push(`## ${heading}: ${status}`, ...meta, "");

    section.querySelectorAll<HTMLLIElement>(".event").forEach((row) => {
      if (!row.hidden) {
        lines.push(row.dataset.text || "");
      }
    });
  });

  navigator.clipboard.writeText(lines.join("\n")).then(
    () => flashButton(copyBtn, "Copied"),
    () => flashButton(copyBtn, "Copy failed"),
  );
}

function flashButton(button: HTMLButtonElement, text: string) {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = original), 1500);
}

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function applyTheme(theme: string) {
  themeSelect.value = theme;
  writeStorage(THEME_KEY, theme);

  if (theme) {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function saveInput() {
  writeStorage(STORAGE_KEY, input.value);
}

function restoreInput() {
  const saved = readStorage(STORAGE_KEY);

  if (saved && !input.value) {
    input.value = saved;
  }
}

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    // Storage may be unavailable in private browsing
    return "";
  }
}

function writeStorage(key: string, value: string) {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable in private browsing
  }
}

function formatMs(value: number): string {
  return `${new Intl.NumberFormat().format(Math.round(value))} ms`;
}

function plural(count: number, noun: string): string {
  return `${new Intl.NumberFormat().format(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function query<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);

  if (!el) {
    throw new Error(`Cannot start debug parser: missing ${selector}`);
  }

  return el;
}
