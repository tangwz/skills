import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { episodeStyle, EpisodeStyle, StylePatch } from "./style";
import { episodeIntervals } from "./video-settings";

const SeriesBackdrop = ({ style }: { style: EpisodeStyle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const offset = (frame / fps) * style.grid.speed;
  const major = `rgba(255,255,255,${style.grid.majorOpacity})`;
  const minor = `rgba(255,255,255,${style.grid.minorOpacity})`;
  return (
    <AbsoluteFill style={{ backgroundColor: style.colors.background }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${major} 1px,transparent 1px),linear-gradient(90deg,${major} 1px,transparent 1px),linear-gradient(${minor} 1px,transparent 1px),linear-gradient(90deg,${minor} 1px,transparent 1px)`,
          backgroundSize: `${style.grid.size * 4}px ${style.grid.size * 4}px,${style.grid.size * 4}px ${style.grid.size * 4}px,${style.grid.size}px ${style.grid.size}px,${style.grid.size}px ${style.grid.size}px`,
          backgroundPosition: `${offset}px 0px`,
        }}
      />
    </AbsoluteFill>
  );
};

const ChannelStamp = ({ style }: { style: EpisodeStyle }) => (
  <div
    style={{
      position: "absolute",
      top: 88,
      right: 112,
      width: style.brand.width,
      height: style.brand.height,
      display: "flex",
      alignItems: "center",
      gap: 16,
      fontSize: 30,
    }}
  >
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      aria-label="Demo channel logo"
    >
      <circle
        cx="28"
        cy="28"
        r="24"
        fill="none"
        stroke={style.colors.accent}
        strokeWidth="4"
      />
      <path
        d="M20 16h12a7 7 0 010 14H20v10"
        fill="none"
        stroke={style.colors.text}
        strokeWidth="4"
      />
    </svg>
    <span>{style.brand.name}</span>
  </div>
);

const ContentScene = ({
  style,
  title,
  text,
  stage,
}: {
  style: EpisodeStyle;
  title: string;
  text: string;
  stage: number;
}) => (
  <AbsoluteFill style={{ padding: "88px 112px" }}>
    <div style={{ maxWidth: 1696 - style.brand.width - style.brand.gap }}>
      <div
        style={{
          fontSize: 24,
          color: style.colors.accent,
          fontWeight: style.typography.headingWeight,
        }}
      >
        EPISODE {stage + 1}
      </div>
      <h1
        style={{
          fontSize: style.typography.titleSize,
          fontWeight: style.typography.headingWeight,
          margin: "24px 0",
          lineHeight: 1.15,
        }}
      >
        {title}
      </h1>
    </div>
    <div
      style={{
        marginTop: 170,
        fontSize: style.typography.bodySize,
        maxWidth: 1400,
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  </AbsoluteFill>
);

export const Episode = ({
  title,
  body,
  patch,
}: {
  title: string;
  body: string;
  patch?: StylePatch;
}) => {
  const style = episodeStyle(patch);
  const copy = [
    "One idea, explained clearly.",
    body,
    "Keep the relationship in mind.",
  ];
  return (
    <AbsoluteFill
      style={{
        color: style.colors.text,
        fontFamily: style.typography.family,
        fontWeight: style.typography.regularWeight,
      }}
    >
      <SeriesBackdrop style={style} />
      {episodeIntervals.map((interval, stage) => (
        <Sequence key={interval.from} {...interval}>
          <ContentScene
            style={style}
            title={stage === 2 ? "The key takeaway" : title}
            text={copy[stage]}
            stage={stage}
          />
        </Sequence>
      ))}
      <ChannelStamp style={style} />
    </AbsoluteFill>
  );
};

export const longEpisodeOverride: StylePatch = {
  grid: { minorOpacity: 0.02 },
  typography: { bodySize: 44 },
};

export const SignalEpisode = () => (
  <Episode
    title="How filters select a signal"
    body="Source > filter > receiver"
  />
);

export const LongTitleEpisode = () => (
  <Episode
    title="How multiple layers of selective filters shape the signal that finally reaches a receiver"
    body="Each layer retains a different part of the incoming signal."
    patch={longEpisodeOverride}
  />
);
