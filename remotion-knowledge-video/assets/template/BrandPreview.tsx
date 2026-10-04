import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  BrandMark,
  EpisodeEndCard,
  EpisodeOpener,
  getBrandMarkWidth,
  KnowledgeBackground,
  KnowledgePanel,
  TitleCard,
} from "./VideoChrome";
import { resolveVideoBrand, type VideoBrand } from "./video-brand";
import { getEndCardTiming } from "./end-card-timing";
import {
  getCanvasScale,
  resolveVideoStyle,
  VIDEO_REVEAL_EASE,
  VIDEO_STYLE,
  type VideoFontRoles,
  type VideoStyle,
  type VideoStyleOverrides,
} from "./video-style";

export const BRAND_PREVIEW_WIDTH = VIDEO_STYLE.canvas.width;
export const BRAND_PREVIEW_HEIGHT = VIDEO_STYLE.canvas.height;
export const BRAND_PREVIEW_FPS = VIDEO_STYLE.canvas.fps;
export const BRAND_PREVIEW_SECONDS = 12;
export const BRAND_PREVIEW_TOTAL_FRAMES = Math.round(
  BRAND_PREVIEW_SECONDS * BRAND_PREVIEW_FPS,
);

export type BrandPreviewContent = {
  openerTitle: string;
  openerSupportingText: string;
  diagramTitle: string;
  diagramSupportingText: string;
  takeaway: string;
};

const DEFAULT_PREVIEW_CONTENT: BrandPreviewContent = {
  openerTitle: "\u8ba9\u6982\u5ff5\u770b\u5f97\u89c1",
  openerSupportingText:
    "\u4e00\u4e2a\u95ee\u9898\uff0c\u4e00\u6761\u6e05\u6670\u7684\u89e3\u91ca\u8def\u5f84\u3002",
  diagramTitle: "\u4ece\u8f93\u5165\u5230\u7ed3\u679c",
  diagramSupportingText:
    "\u628a\u4e00\u4e2a\u6982\u5ff5\uff0c\u62c6\u6210\u770b\u5f97\u89c1\u7684\u8fc7\u7a0b\u3002",
  takeaway:
    "\u7406\u89e3\u8fc7\u7a0b\uff0c\u518d\u8bb0\u4f4f\u7ed3\u8bba\u3002",
};

export type BrandPreviewProps = {
  fonts: VideoFontRoles;
  brand?: Partial<VideoBrand>;
  styleOverrides?: VideoStyleOverrides;
  content?: Partial<BrandPreviewContent>;
};

const ProcessDiagram = ({
  fonts,
  theme,
  content,
  brand,
}: {
  fonts: VideoFontRoles;
  theme: VideoStyle;
  content: BrandPreviewContent;
  brand: VideoBrand;
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const scale = getCanvasScale(width, height, theme);
  const inset = theme.layout.safeMargin * scale;
  const brandWidth = getBrandMarkWidth(brand, theme);
  const titleRight =
    inset + (brandWidth > 0 ? (brandWidth + theme.layout.gap) * scale : 0);
  const progress = interpolate(frame, [0.25 * fps, 0.95 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: VIDEO_REVEAL_EASE,
  });
  const labelStyle = {
    fontFamily: fonts.body,
    fontSize: theme.typography.sizes.label * scale,
    fontWeight: theme.typography.weights.emphasis,
    color: theme.colors.muted,
  };

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: inset,
          right: titleRight,
          top: 128 * scale,
        }}
      >
        <TitleCard
          fonts={fonts}
          theme={theme}
          kicker="EXPLAIN ONE IDEA"
          title={content.diagramTitle}
          supportingText={content.diagramSupportingText}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: inset,
          right: inset,
          top: "48%",
          bottom: "21%",
          display: "grid",
          gridTemplateColumns: "1fr 0.34fr 1.32fr 0.34fr 1fr",
          alignItems: "center",
          opacity: progress,
          transform: `translateY(${(1 - progress) * 18 * scale}px)`,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={labelStyle}>SOURCE</div>
          <div
            style={{
              margin: `${24 * scale}px auto`,
              display: "flex",
              justifyContent: "center",
              gap: 12 * scale,
            }}
          >
            {[0.5, 0.8, 0.65].map((value, index) => (
              <div
                key={index}
                style={{
                  width: 58 * scale,
                  height: 128 * scale,
                  display: "flex",
                  alignItems: "flex-end",
                  borderBottom: `${2 * scale}px solid ${theme.colors.line}`,
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: `${value * 100}%`,
                    backgroundColor: theme.colors.cyan,
                    borderRadius: `${7 * scale}px ${7 * scale}px 0 0`,
                    opacity: 0.72 + index * 0.1,
                  }}
                />
              </div>
            ))}
          </div>
          <div
            style={{
              fontFamily: fonts.chinese,
              fontSize: theme.typography.sizes.body * scale,
              fontWeight: theme.typography.weights.emphasis,
              color: theme.colors.ink,
            }}
          >
            {"\u4fe1\u606f"}
          </div>
        </div>
        <svg viewBox="0 0 100 40" width="100%" aria-hidden>
          <path
            d="M 6 20 H 84 M 74 10 L 84 20 L 74 30"
            fill="none"
            stroke={theme.colors.cyan}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <KnowledgePanel
          fonts={fonts}
          theme={theme}
          label="PROCESS"
          strong
          style={{
            textAlign: "center",
            padding: `${38 * scale}px ${20 * scale}px`,
          }}
        >
          <div
            style={{
              fontSize: theme.typography.sizes.heading * scale,
              fontWeight: theme.typography.weights.emphasis,
            }}
          >
            {"\u9009\u62e9 \u00b7 \u7ec4\u5408"}
          </div>
          <div
            style={{
              marginTop: 18 * scale,
              fontFamily: fonts.mono,
              fontSize: theme.typography.sizes.mono * scale,
              color: theme.colors.cyan,
            }}
          >
            f(x)
          </div>
        </KnowledgePanel>
        <svg viewBox="0 0 100 40" width="100%" aria-hidden>
          <path
            d="M 6 20 H 84 M 74 10 L 84 20 L 74 30"
            fill="none"
            stroke={theme.colors.orange}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div style={{ textAlign: "center" }}>
          <div style={labelStyle}>RESULT</div>
          <div
            style={{
              width: 112 * scale,
              height: 112 * scale,
              margin: `${28 * scale}px auto`,
              border: `${3 * scale}px solid ${theme.colors.orange}`,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="60%" viewBox="0 0 60 60" aria-hidden>
              <path
                d="M 14 30 L 25 41 L 47 19"
                fill="none"
                stroke={theme.colors.orange}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div
            style={{
              fontFamily: fonts.chinese,
              fontSize: theme.typography.sizes.body * scale,
              fontWeight: theme.typography.weights.emphasis,
              color: theme.colors.ink,
            }}
          >
            {"\u7ed3\u8bba"}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Load fonts in the outer composition before passing registered font aliases here.
export const BrandPreview = ({
  fonts,
  brand: brandOverrides,
  styleOverrides,
  content: contentOverrides,
}: BrandPreviewProps) => {
  const { fps } = useVideoConfig();
  const theme = resolveVideoStyle(styleOverrides);
  const brand = resolveVideoBrand(brandOverrides);
  const content = { ...DEFAULT_PREVIEW_CONTENT, ...contentOverrides };
  const endTiming = getEndCardTiming({ fps, ...theme.motion });
  if (
    !Number.isFinite(theme.motion.openerSeconds) ||
    theme.motion.openerSeconds < 0
  )
    throw new Error("The opener duration must be finite and non-negative.");
  const openerFrames = Math.round(theme.motion.openerSeconds * fps);
  const endFrames = endTiming.endCardFrames;
  const totalFrames = Math.round(BRAND_PREVIEW_SECONDS * fps);
  const bodyFrames = totalFrames - openerFrames - endFrames;
  if (bodyFrames <= 0)
    throw new Error("The preview needs a positive body duration.");

  return (
    <AbsoluteFill>
      <KnowledgeBackground
        theme={theme}
        holdSeconds={endTiming.holdFrames / fps}
      />
      {openerFrames > 0 ? (
        <Sequence durationInFrames={openerFrames}>
          <EpisodeOpener
            fonts={fonts}
            theme={theme}
            brand={brand}
            showBackground={false}
            kicker="KNOWLEDGE VIDEO"
            title={content.openerTitle}
            supportingText={content.openerSupportingText}
          />
        </Sequence>
      ) : null}
      <Sequence from={openerFrames} durationInFrames={bodyFrames}>
        <ProcessDiagram
          fonts={fonts}
          theme={theme}
          content={content}
          brand={brand}
        />
        <BrandMark fonts={fonts} theme={theme} brand={brand} />
      </Sequence>
      {endFrames > 0 ? (
        <Sequence from={openerFrames + bodyFrames} durationInFrames={endFrames}>
          <EpisodeEndCard
            fonts={fonts}
            theme={theme}
            brand={brand}
            showBackground={false}
            takeaway={content.takeaway}
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
