import type { AppState, ViewName, WindowName } from "./types";

export const state: AppState = {
  window: "day",
  date: "",
  view: "review",
  selectedSessionId: null,
  selectedWorkflowId: null,
  workflowActionMessage: "",
  analysisActionMessage: "",
  analysisApplyNames: false,
  analysisIncludeShortForm: false,
  analysisPollTimer: null,
  analysisRefreshing: false,
  latestDashboard: null,
  refreshTimer: null,
};

export function buildQueryString(): string {
  const params = new URLSearchParams();
  params.set("window", state.window);
  params.set("view", state.view);

  if (state.date) {
    params.set("date", state.date);
  }

  if (state.analysisIncludeShortForm) {
    params.set("includeShortForm", "1");
  }

  return params.toString();
}

export function syncUrl(): void {
  const url = new URL(window.location.href);
  url.search = buildQueryString();
  window.history.replaceState({}, "", url);
}

export function initializeStateFromUrl(): void {
  const url = new URL(window.location.href);
  const selectedWindow = url.searchParams.get("window");
  const selectedDate = url.searchParams.get("date");
  const selectedView = url.searchParams.get("view");
  const includeShortForm = url.searchParams.get("includeShortForm");

  if (selectedWindow === "day" || selectedWindow === "week" || selectedWindow === "all") {
    state.window = selectedWindow as WindowName;
  }

  if (selectedView === "insights" || selectedView === "review" || selectedView === "analysis") {
    state.view = selectedView as ViewName;
  }

  if (selectedDate) {
    state.date = selectedDate;
  }

  if (includeShortForm === "1") {
    state.analysisIncludeShortForm = true;
  }
}

// Theme management
export function getTheme(): string | null {
  return localStorage.getItem("wid-theme");
}

export function setTheme(theme: "light" | "dark" | "auto"): void {
  if (theme === "auto") {
    localStorage.removeItem("wid-theme");
    document.documentElement.removeAttribute("data-theme");
  } else {
    localStorage.setItem("wid-theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function initializeTheme(): void {
  const saved = getTheme();
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
}

export function toggleTheme(): void {
  const current = getTheme();
  const isDark =
    current === "dark" ||
    (!current && window.matchMedia("(prefers-color-scheme: dark)").matches);
  setTheme(isDark ? "light" : "dark");
}
