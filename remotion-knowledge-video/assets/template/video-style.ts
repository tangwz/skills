import { useLayoutEffect } from "react";
import {
  cancelRender,
  continueRender,
  delayRender,
  Easing,
  staticFile,
} from "remotion";

export type VideoFontRole = "title" | "body" | "chinese" | "mono";
export type VideoFontRoles = Record<VideoFontRole, string>;

export const VIDEO_FONT_ROLES: VideoFontRoles = {
  title: "Knowledge Display",
  body: "Knowledge Sans",
  chinese: "Knowledge Chinese",
  mono: "Knowledge Mono",
};

export const VIDEO_STYLE = {
  canvas: { width: 1920, height: 1080, fps: 60 },
  colors: {
    background: "#030404",
    panel: "#0d2035",
    panelStrong: "#102a43",
    ink: "#f8fafc",
    muted: "#91a4bb",
    cyan: "#23c7d7",
    orange: "#ff7a30",
    blue: "#3c82d6",
    violet: "#9346b5",
    green: "#2dcf8b",
    red: "#f05252",
    line: "rgba(255, 255, 255, 0.15)",
  },
  typography: {
    sizes: {
      display: 100,
      title: 64,
      takeaway: 56,
      heading: 42,
      body: 40,
      detail: 28,
      label: 32,
      brand: 24,
      mono: 32,
    },
    weights: { title: 700, body: 500, emphasis: 600, mono: 500 },
    titleLineHeight: 1.16,
    bodyLineHeight: 1.45,
  },
  layout: {
    safeMargin: 90,
    panelRadius: 22,
    panelPadding: 40,
    gap: 32,
    logoWidth: 156,
    logoHeight: 46,
  },
  grid: {
    animate: true,
    speed: 20,
    angle: -35,
    minorSpacing: 20,
    majorSpacing: 80,
    minorOpacity: 0.045,
    majorOpacity: 0.15,
  },
  motion: {
    revealSeconds: 0.8,
    staggerSeconds: 0.3,
    openerSeconds: 2,
    endCardSeconds: 3,
    endHoldSeconds: 1.5,
  },
};

export type VideoStyle = typeof VIDEO_STYLE;
export type VideoStyleOverrides = {
  [Section in Exclude<keyof VideoStyle, "typography">]?: Partial<
    VideoStyle[Section]
  >;
} & {
  typography?: Partial<Omit<VideoStyle["typography"], "sizes" | "weights">> & {
    sizes?: Partial<VideoStyle["typography"]["sizes"]>;
    weights?: Partial<VideoStyle["typography"]["weights"]>;
  };
};

export const resolveVideoStyle = (
  overrides: VideoStyleOverrides = {},
): VideoStyle => ({
  canvas: { ...VIDEO_STYLE.canvas, ...overrides.canvas },
  colors: { ...VIDEO_STYLE.colors, ...overrides.colors },
  typography: {
    ...VIDEO_STYLE.typography,
    ...overrides.typography,
    sizes: { ...VIDEO_STYLE.typography.sizes, ...overrides.typography?.sizes },
    weights: {
      ...VIDEO_STYLE.typography.weights,
      ...overrides.typography?.weights,
    },
  },
  layout: { ...VIDEO_STYLE.layout, ...overrides.layout },
  grid: { ...VIDEO_STYLE.grid, ...overrides.grid },
  motion: { ...VIDEO_STYLE.motion, ...overrides.motion },
});

export const VIDEO_REVEAL_EASE = Easing.bezier(0.16, 1, 0.3, 1);

// Scale landscape spacing uniformly. Portrait scenes require their own layout reflow.
export const getCanvasScale = (
  width: number,
  height: number,
  theme = VIDEO_STYLE,
): number => Math.min(width / theme.canvas.width, height / theme.canvas.height);

export const publicAssetPath = (path: string): string => {
  if (
    !path.trim() ||
    path.startsWith("/") ||
    /^[a-z]+:/i.test(path) ||
    path.split("/").indexOf("..") !== -1
  ) {
    throw new Error("Assets must use a non-empty path relative to public/.");
  }
  return staticFile(path);
};

export type LocalVideoFont = {
  role: VideoFontRole;
  path: string;
  weight: string;
  style?: "normal" | "italic";
  format?: "woff2" | "woff" | "truetype" | "opentype" | "collection";
};

type FontLoadResult =
  | { success: true; font: FontFace }
  | { success: false; error: unknown };

const fontFaceLoads = new Map<string, Promise<FontLoadResult[]>>();
const fontLoads = new Map<string, Promise<void>>();
const fontFaceUsers = new Map<FontFace, number>();
const permanentFontFaces = new Set<FontFace>();

const loadLocalVideoFontFaces = (
  fonts: VideoFontRoles,
  sources: readonly LocalVideoFont[],
): Promise<FontLoadResult[]> => {
  const key = JSON.stringify({ fonts, sources });
  let load = fontFaceLoads.get(key);
  if (!load) {
    load = (async () => {
      const roles: VideoFontRole[] = ["title", "body", "chinese", "mono"];
      for (const role of roles) {
        if (
          !fonts[role].trim() ||
          !sources.some((source) => source.role === role)
        ) {
          throw new Error(
            `A local font source is required for the ${role} role.`,
          );
        }
      }
      return Promise.all(
        sources.map(async (source) => {
          try {
            const font = new FontFace(
              fonts[source.role],
              `url("${publicAssetPath(source.path)}") format("${source.format ?? "woff2"}")`,
              { weight: source.weight, style: source.style ?? "normal" },
            );
            return { success: true, font: await font.load() } as const;
          } catch (error) {
            return { success: false, error } as const;
          }
        }),
      );
    })().then(
      (results) => {
        // Finish every concurrent font request before allowing a retry.
        if (
          results.some((result) => !result.success) &&
          fontFaceLoads.get(key) === load
        )
          fontFaceLoads.delete(key);
        return results;
      },
      (error) => {
        if (fontFaceLoads.get(key) === load) fontFaceLoads.delete(key);
        throw error;
      },
    );
    fontFaceLoads.set(key, load);
  }
  return load;
};

const successfulFontFaces = (results: FontLoadResult[]): FontFace[] => {
  const failed = results.find((result) => !result.success);
  if (failed && !failed.success) throw failed.error;
  const faces: FontFace[] = [];
  for (const result of results) {
    if (result.success) faces.push(result.font);
  }
  return faces;
};

const retainFontFaces = (faces: FontFace[]): (() => void) => {
  for (const font of faces) {
    fontFaceUsers.set(font, (fontFaceUsers.get(font) ?? 0) + 1);
    document.fonts.add(font);
  }
  return () => {
    for (const font of faces) {
      const users = (fontFaceUsers.get(font) ?? 1) - 1;
      if (users > 0) fontFaceUsers.set(font, users);
      else {
        fontFaceUsers.delete(font);
        if (!permanentFontFaces.has(font)) document.fonts.delete(font);
      }
    }
  };
};

export const loadLocalVideoFonts = (
  fonts: VideoFontRoles,
  sources: readonly LocalVideoFont[],
): Promise<void> => {
  const key = JSON.stringify({ fonts, sources });
  let load = fontLoads.get(key);
  if (!load) {
    load = loadLocalVideoFontFaces(fonts, sources)
      .then((results) => {
        for (const result of results) {
          if (result.success) {
            permanentFontFaces.add(result.font);
            document.fonts.add(result.font);
          }
        }
        successfulFontFaces(results);
      })
      .catch((error) => {
        if (fontLoads.get(key) === load) fontLoads.delete(key);
        throw error;
      });
    fontLoads.set(key, load);
  }
  return load;
};

// An existing project font hook can replace this loader if it registers the same aliases.
export const useLocalVideoFonts = (
  fonts: VideoFontRoles,
  sources: readonly LocalVideoFont[],
): void => {
  const key = JSON.stringify({ fonts, sources });

  // Block each committed configuration before the browser can paint its fonts.
  useLayoutEffect(() => {
    const handle = delayRender("Loading knowledge video fonts");
    let active = true;
    let released = false;
    let unregister: (() => void) | undefined;
    const release = () => {
      if (!released) {
        released = true;
        continueRender(handle);
      }
    };
    const configuration = JSON.parse(key) as {
      fonts: VideoFontRoles;
      sources: LocalVideoFont[];
    };
    loadLocalVideoFontFaces(configuration.fonts, configuration.sources)
      .then((results) => {
        if (!active) return;
        unregister = retainFontFaces(successfulFontFaces(results));
        release();
      })
      .catch((error) => {
        if (active) {
          release();
          cancelRender(error);
        }
      });
    return () => {
      active = false;
      unregister?.();
      release();
    };
  }, [key]);
};
