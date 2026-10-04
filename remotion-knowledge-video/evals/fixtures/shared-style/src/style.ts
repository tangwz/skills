export type EpisodeStyle = {
  colors: { background: string; text: string; accent: string; muted: string };
  grid: {
    size: number;
    speed: number;
    majorOpacity: number;
    minorOpacity: number;
  };
  typography: {
    family: string;
    titleSize: number;
    bodySize: number;
    regularWeight: number;
    headingWeight: number;
  };
  brand: { name: string; width: number; height: number; gap: number };
};

export type StylePatch = {
  [Key in keyof EpisodeStyle]?: Partial<EpisodeStyle[Key]>;
};

export const seriesDefaults: EpisodeStyle = {
  colors: {
    background: "#05080b",
    text: "#f3f7fb",
    accent: "#08c9db",
    muted: "#96a9bc",
  },
  grid: { size: 64, speed: 12, majorOpacity: 0.115, minorOpacity: 0.045 },
  typography: {
    family: 'Arial, "Songti SC", "SimSun", serif',
    titleSize: 64,
    bodySize: 48,
    regularWeight: 400,
    headingWeight: 700,
  },
  brand: { name: "Demo Science", width: 300, height: 90, gap: 32 },
};

export const episodeStyle = (patch: StylePatch = {}): EpisodeStyle => ({
  colors: { ...seriesDefaults.colors, ...patch.colors },
  grid: { ...seriesDefaults.grid, ...patch.grid },
  typography: { ...seriesDefaults.typography, ...patch.typography },
  brand: { ...seriesDefaults.brand, ...patch.brand },
});
