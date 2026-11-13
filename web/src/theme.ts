const THEME_KEY = "vozlinija-theme";

export type Theme = "light" | "dark";

export function readTheme(): Theme {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (raw === "dark" || raw === "light") return raw;
  } catch {
    // ignore
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function writeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
