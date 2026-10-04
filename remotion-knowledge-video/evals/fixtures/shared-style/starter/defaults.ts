import type { EpisodeStyle } from "../src/style";

export const starterDefaults: EpisodeStyle = {
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
