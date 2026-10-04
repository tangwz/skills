import { useId, type CSSProperties, type ReactNode } from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { VIDEO_BRAND, type VideoBrand } from "./video-brand";
import { getGridTravelSeconds } from "./grid-motion";
import { getEndCardTiming } from "./end-card-timing";
import {
  getCanvasScale,
  publicAssetPath,
  VIDEO_REVEAL_EASE,
  VIDEO_STYLE,
  type VideoFontRole,
  type VideoFontRoles,
  type VideoStyle,
} from "./video-style";

type ChromeProps = {
  fonts: VideoFontRoles;
  theme?: VideoStyle;
};

const revealAt = (frame: number, start: number, duration: number): number =>
  interpolate(frame, [start, start + Math.max(1, duration)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: VIDEO_REVEAL_EASE,
  });

export const KnowledgeBackground = ({
  theme = VIDEO_STYLE,
  holdSeconds = 0,
}: {
  theme?: VideoStyle;
  holdSeconds?: number;
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const scale = getCanvasScale(width, height, theme);
  const id = useId().replace(/:/g, "");
  const minor = theme.grid.minorSpacing * scale;
  const major = theme.grid.majorSpacing * scale;
  const travelSeconds = getGridTravelSeconds(
    frame / fps,
    durationInFrames / fps,
    holdSeconds,
  );
  const distance = theme.grid.animate
    ? travelSeconds * theme.grid.speed * scale
    : 0;
  const angle = (theme.grid.angle * Math.PI) / 180;
  const offset = `translate(${Math.cos(angle) * distance} ${Math.sin(angle) * distance})`;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0 }}
        aria-hidden
      >
        <defs>
          <pattern
            id={`${id}-minor`}
            width={minor}
            height={minor}
            patternUnits="userSpaceOnUse"
            patternTransform={offset}
          >
            <path
              d={`M ${minor} 0 H 0 V ${minor}`}
              fill="none"
              stroke={theme.colors.ink}
              strokeWidth={scale}
              opacity={theme.grid.minorOpacity}
            />
          </pattern>
          <pattern
            id={`${id}-major`}
            width={major}
            height={major}
            patternUnits="userSpaceOnUse"
            patternTransform={offset}
          >
            <path
              d={`M ${major} 0 H 0 V ${major}`}
              fill="none"
              stroke={theme.colors.ink}
              strokeWidth={1.4 * scale}
              opacity={theme.grid.majorOpacity}
            />
          </pattern>
        </defs>
        <rect width={width} height={height} fill={`url(#${id}-minor)`} />
        <rect width={width} height={height} fill={`url(#${id}-major)`} />
      </svg>
    </AbsoluteFill>
  );
};

export const getBrandMarkWidth = (
  brand: VideoBrand,
  theme = VIDEO_STYLE,
): number =>
  brand.logoPath
    ? Math.min(320, theme.layout.logoWidth)
    : brand.channelName
      ? 320
      : 0;

export const BrandMark = ({
  fonts,
  theme = VIDEO_STYLE,
  brand = VIDEO_BRAND,
  placement = "top-right",
  opacity = 0.65,
  fontRole,
}: ChromeProps & {
  brand?: VideoBrand;
  placement?: "top-right" | "bottom-right" | "inline";
  opacity?: number;
  fontRole?: VideoFontRole;
}) => {
  const { width, height } = useVideoConfig();
  const scale = getCanvasScale(width, height, theme);
  const inset = theme.layout.safeMargin * scale;
  const position: CSSProperties =
    placement === "inline"
      ? {}
      : {
          position: "absolute",
          right: inset,
          ...(placement === "top-right" ? { top: inset } : { bottom: inset }),
        };
  if (!brand.logoPath && !brand.channelName) return null;

  return (
    <div
      style={{
        ...position,
        display: "flex",
        alignItems: "center",
        gap: 16 * scale,
        opacity,
        color: theme.colors.muted,
        fontFamily:
          fonts[
            fontRole ??
              (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
                brand.channelName ?? "",
              )
                ? "chinese"
                : "body")
          ],
        fontSize: theme.typography.sizes.brand * scale,
        fontWeight: theme.typography.weights.body,
        maxWidth: 320 * scale,
        overflowWrap: "anywhere",
        lineHeight: 1.3,
        textAlign: "right",
      }}
    >
      {brand.logoPath ? (
        <Img
          src={publicAssetPath(brand.logoPath)}
          style={{
            width: getBrandMarkWidth(brand, theme) * scale,
            height: theme.layout.logoHeight * scale,
            objectFit: "contain",
            objectPosition: "right center",
          }}
        />
      ) : (
        brand.channelName
      )}
    </div>
  );
};

export const TitleCard = ({
  fonts,
  theme = VIDEO_STYLE,
  title,
  kicker,
  supportingText,
  fontRole = "chinese",
  accent = "cyan",
  size = "title",
  align = "left",
}: ChromeProps & {
  title: ReactNode;
  kicker?: string;
  supportingText?: ReactNode;
  fontRole?: VideoFontRole;
  accent?: "cyan" | "orange";
  size?: "title" | "display";
  align?: "left" | "center";
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const scale = getCanvasScale(width, height, theme);
  const progress = revealAt(frame, 0, theme.motion.revealSeconds * fps);
  const detailProgress = revealAt(
    frame,
    theme.motion.staggerSeconds * fps,
    theme.motion.revealSeconds * fps,
  );

  return (
    <div style={{ color: theme.colors.ink, textAlign: align, width: "100%" }}>
      {kicker ? (
        <div
          style={{
            color: theme.colors[accent],
            fontFamily: fonts.body,
            fontSize: theme.typography.sizes.label * scale,
            fontWeight: theme.typography.weights.emphasis,
            letterSpacing: "0.12em",
            marginBottom: 24 * scale,
            opacity: progress,
          }}
        >
          {kicker}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: fonts[fontRole],
          fontSize: theme.typography.sizes[size] * scale,
          fontWeight: theme.typography.weights.title,
          lineHeight: theme.typography.titleLineHeight,
          textWrap: "balance",
          letterSpacing: "-0.035em",
          opacity: progress,
          transform: `translateY(${(1 - progress) * 24 * scale}px)`,
        }}
      >
        {title}
      </div>
      {supportingText ? (
        <div
          style={{
            marginTop: 28 * scale,
            fontFamily: fonts.chinese,
            color: theme.colors.muted,
            fontSize: theme.typography.sizes.body * scale,
            fontWeight: theme.typography.weights.body,
            lineHeight: theme.typography.bodyLineHeight,
            opacity: detailProgress,
          }}
        >
          {supportingText}
        </div>
      ) : null}
    </div>
  );
};

export const KnowledgePanel = ({
  fonts,
  theme = VIDEO_STYLE,
  children,
  label,
  accent = "cyan",
  strong = false,
  style,
}: ChromeProps & {
  children: ReactNode;
  label?: string;
  accent?: "cyan" | "orange";
  strong?: boolean;
  style?: CSSProperties;
}) => {
  const { width, height } = useVideoConfig();
  const scale = getCanvasScale(width, height, theme);

  return (
    <div
      style={{
        backgroundColor: strong ? theme.colors.panelStrong : theme.colors.panel,
        border: `${1.5 * scale}px solid ${theme.colors.line}`,
        borderRadius: theme.layout.panelRadius * scale,
        padding: theme.layout.panelPadding * scale,
        color: theme.colors.ink,
        fontFamily: fonts.chinese,
        fontSize: theme.typography.sizes.body * scale,
        fontWeight: theme.typography.weights.body,
        lineHeight: theme.typography.bodyLineHeight,
        ...style,
      }}
    >
      {label ? (
        <div
          style={{
            color: theme.colors[accent],
            fontSize: theme.typography.sizes.label * scale,
            fontFamily: fonts.body,
            fontWeight: theme.typography.weights.emphasis,
            marginBottom: 20 * scale,
          }}
        >
          {label}
        </div>
      ) : null}
      {children}
    </div>
  );
};

export const EpisodeOpener = ({
  fonts,
  theme = VIDEO_STYLE,
  brand = VIDEO_BRAND,
  title,
  kicker,
  supportingText,
  showBrand = true,
  showBackground = true,
  enabled = true,
}: ChromeProps & {
  brand?: VideoBrand;
  title: ReactNode;
  kicker?: string;
  supportingText?: ReactNode;
  showBrand?: boolean;
  showBackground?: boolean;
  enabled?: boolean;
}) => {
  const { width, height } = useVideoConfig();
  const scale = getCanvasScale(width, height, theme);
  if (!enabled) return null;

  return (
    <AbsoluteFill>
      {showBackground ? <KnowledgeBackground theme={theme} /> : null}
      {showBrand ? (
        <BrandMark fonts={fonts} theme={theme} brand={brand} />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: theme.layout.safeMargin * scale,
          right: theme.layout.safeMargin * scale,
          top: "34%",
        }}
      >
        <TitleCard
          fonts={fonts}
          theme={theme}
          title={title}
          kicker={kicker}
          supportingText={supportingText}
          size="display"
        />
        {showBrand && brand.tagline ? (
          <div
            style={{
              marginTop: 40 * scale,
              fontFamily: fonts.chinese,
              fontSize: theme.typography.sizes.detail * scale,
              color: theme.colors.muted,
            }}
          >
            {brand.tagline}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const EpisodeEndCard = ({
  fonts,
  theme = VIDEO_STYLE,
  brand = VIDEO_BRAND,
  takeaway,
  label = "TAKEAWAY",
  showBrand = true,
  showBackground = true,
  enabled = true,
}: ChromeProps & {
  brand?: VideoBrand;
  takeaway: ReactNode;
  label?: string;
  showBrand?: boolean;
  showBackground?: boolean;
  enabled?: boolean;
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  if (!enabled) return null;
  const timing = getEndCardTiming({ fps, ...theme.motion, durationInFrames });
  if (timing.endCardFrames === 0) return null;
  const scale = getCanvasScale(width, height, theme);
  const progress =
    timing.revealFrames === 0 ? 1 : revealAt(frame, 0, timing.revealFrames);

  return (
    <AbsoluteFill>
      {showBackground ? (
        <KnowledgeBackground
          theme={theme}
          holdSeconds={timing.holdFrames / fps}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: theme.layout.safeMargin * scale,
          right: theme.layout.safeMargin * scale,
          top: "32%",
          opacity: progress,
          transform: `translateY(${(1 - progress) * 20 * scale}px)`,
        }}
      >
        <div
          style={{
            width: 64 * scale,
            height: 5 * scale,
            backgroundColor: theme.colors.orange,
            marginBottom: 28 * scale,
          }}
        />
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: theme.typography.sizes.label * scale,
            fontWeight: theme.typography.weights.emphasis,
            color: theme.colors.orange,
            letterSpacing: "0.12em",
            marginBottom: 22 * scale,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: fonts.chinese,
            fontSize: theme.typography.sizes.takeaway * scale,
            fontWeight: theme.typography.weights.title,
            lineHeight: theme.typography.titleLineHeight,
            textWrap: "balance",
            color: theme.colors.ink,
          }}
        >
          {takeaway}
        </div>
        {showBrand && brand.endNote ? (
          <div
            style={{
              marginTop: 32 * scale,
              fontFamily: fonts.chinese,
              fontSize: theme.typography.sizes.body * scale,
              color: theme.colors.muted,
            }}
          >
            {brand.endNote}
          </div>
        ) : null}
      </div>
      {showBrand ? (
        <BrandMark
          fonts={fonts}
          theme={theme}
          brand={brand}
          placement="bottom-right"
          opacity={0.65 * progress}
        />
      ) : null}
    </AbsoluteFill>
  );
};
