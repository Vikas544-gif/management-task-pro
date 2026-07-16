import { createContext, useContext, useState, useLayoutEffect, ReactNode } from "react";

export type ThemeName =
  | "light"
  | "dark"
  | "midnight"
  | "slate"
  | "sepia"
  | "ocean"
  | "forest"
  | "sunset"
  | "coffee"
  | "neon"
  | "bubblegum";
export type Accent =
  | "indigo"
  | "blue"
  | "emerald"
  | "violet"
  | "rose"
  | "amber"
  | "teal"
  | "cyan"
  | "pink"
  | "orange"
  | "lime"
  | "fuchsia"
  | "sky";

export const THEMES: { id: ThemeName; label: string; emoji: string; bg: string; fg: string }[] = [
  { id: "light", label: "Light", emoji: "☀️", bg: "hsl(210 40% 98%)", fg: "hsl(222 47% 11%)" },
  { id: "dark", label: "Dark", emoji: "🌑", bg: "hsl(222 47% 9%)", fg: "hsl(210 40% 98%)" },
  { id: "midnight", label: "Midnight", emoji: "🌌", bg: "hsl(230 45% 11%)", fg: "hsl(214 32% 92%)" },
  { id: "slate", label: "Slate", emoji: "🪨", bg: "hsl(215 22% 17%)", fg: "hsl(210 22% 93%)" },
  { id: "sepia", label: "Sepia", emoji: "📜", bg: "hsl(40 38% 95%)", fg: "hsl(30 28% 16%)" },
  { id: "ocean", label: "Ocean", emoji: "🌊", bg: "hsl(200 60% 8%)", fg: "hsl(190 30% 92%)" },
  { id: "forest", label: "Forest", emoji: "🌲", bg: "hsl(150 30% 8%)", fg: "hsl(120 15% 90%)" },
  { id: "sunset", label: "Sunset", emoji: "🌇", bg: "hsl(280 35% 10%)", fg: "hsl(30 40% 94%)" },
  { id: "coffee", label: "Coffee", emoji: "☕", bg: "hsl(25 25% 11%)", fg: "hsl(35 25% 90%)" },
  { id: "neon", label: "Neon", emoji: "⚡", bg: "hsl(250 50% 6%)", fg: "hsl(180 60% 88%)" },
  { id: "bubblegum", label: "Bubblegum", emoji: "🍬", bg: "hsl(330 60% 97%)", fg: "hsl(320 40% 18%)" },
];

export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: "indigo", label: "Indigo", swatch: "hsl(239 84% 67%)" },
  { id: "blue", label: "Blue", swatch: "hsl(217 91% 60%)" },
  { id: "sky", label: "Sky", swatch: "hsl(199 89% 48%)" },
  { id: "cyan", label: "Cyan", swatch: "hsl(188 86% 43%)" },
  { id: "teal", label: "Teal", swatch: "hsl(175 84% 32%)" },
  { id: "emerald", label: "Emerald", swatch: "hsl(160 84% 39%)" },
  { id: "lime", label: "Lime", swatch: "hsl(84 70% 40%)" },
  { id: "amber", label: "Amber", swatch: "hsl(32 95% 44%)" },
  { id: "orange", label: "Orange", swatch: "hsl(25 95% 53%)" },
  { id: "rose", label: "Rose", swatch: "hsl(347 77% 50%)" },
  { id: "pink", label: "Pink", swatch: "hsl(330 81% 60%)" },
  { id: "fuchsia", label: "Fuchsia", swatch: "hsl(292 84% 61%)" },
  { id: "violet", label: "Violet", swatch: "hsl(262 83% 58%)" },
];

const DARK_THEMES: ThemeName[] = ["dark", "midnight", "slate", "ocean", "forest", "sunset", "coffee", "neon"];

interface ThemeState {
  theme: ThemeName;
  accent: Accent;
  setTheme: (t: ThemeName) => void;
  setAccent: (a: Accent) => void;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

const STORAGE_KEY = "iss_theme";

function loadInitial(): { theme: ThemeName; accent: Accent } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // migrate older { mode: "light" | "dark" } shape
      const themeCandidate: string = parsed.theme ?? parsed.mode ?? "light";
      const theme = THEMES.some((t) => t.id === themeCandidate) ? (themeCandidate as ThemeName) : "light";
      const accent = ACCENTS.some((a) => a.id === parsed.accent) ? (parsed.accent as Accent) : "indigo";
      return { theme, accent };
    }
  } catch {
    /* ignore */
  }
  return { theme: "light", accent: "indigo" };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initial = loadInitial();
  const [theme, setThemeState] = useState<ThemeName>(initial.theme);
  const [accent, setAccentState] = useState<Accent>(initial.accent);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-accent", accent);
    root.classList.toggle("dark", DARK_THEMES.includes(theme));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, accent }));
    } catch {
      /* ignore */
    }
  }, [theme, accent]);

  const value: ThemeState = {
    theme,
    accent,
    setTheme: setThemeState,
    setAccent: setAccentState,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
