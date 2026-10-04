import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { clipSettings, sceneIntervals } from "./clip-settings";
import { LegacyBackdrop } from "./LegacyBackdrop";
import { narration } from "./narration";
import { channelTheme } from "./theme";
import { clipFontFamily, useClipFont } from "./useClipFont";

const ProductIcon = () => (
  <svg
    width="120"
    height="120"
    viewBox="0 0 120 120"
    aria-label="Filter product"
  >
    <rect
      x="8"
      y="8"
      width="104"
      height="104"
      rx="18"
      fill={channelTheme.source}
    />
    <path d="M28 36h64L68 64v22H52V64z" fill={channelTheme.background} />
  </svg>
);

const DiagramScene = ({ stage }: { stage: number }) => {
  const localFrame = useCurrentFrame();
  const labels = ["SOURCE", "FILTER", "RECEIVER"];
  return (
    <AbsoluteFill>
      <LegacyBackdrop />
      <div style={{ position: "absolute", left: 112, top: 90 }}>
        <div style={{ fontSize: 24, color: channelTheme.source }}>
          SIGNAL PATH
        </div>
        <h1 style={{ fontSize: 64 }}>From emission to observation</h1>
      </div>
      <div
        style={{
          position: "absolute",
          left: 160,
          top: 410,
          display: "flex",
          gap: 100,
          alignItems: "center",
        }}
      >
        {labels.map((label, index) => (
          <div
            key={label}
            style={{
              opacity: index <= stage ? 1 : 0.3,
              width: 360,
              textAlign: "center",
            }}
          >
            {index === 1 ? (
              <ProductIcon />
            ) : (
              <div
                style={{
                  height: 120,
                  fontSize: 72,
                  color: channelTheme.result,
                }}
              >
                {index === 0 ? "~" : "="}
              </div>
            )}
            <div style={{ fontSize: 36, marginTop: 24 }}>{label}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 160,
          bottom: 140,
          width: Math.min(localFrame * 3, 1100),
          height: 5,
          background: channelTheme.source,
        }}
      />
    </AbsoluteFill>
  );
};

export const MechanismSection = () => {
  useClipFont();
  const frame = useCurrentFrame();
  const caption = narration.find(
    (cue) => frame >= cue.startFrame && frame < cue.endFrame,
  );
  return (
    <AbsoluteFill
      style={{ fontFamily: clipFontFamily, color: channelTheme.text }}
    >
      {sceneIntervals.map((interval, stage) => (
        <Sequence key={interval.from} {...interval}>
          <DiagramScene stage={stage} />
        </Sequence>
      ))}
      {clipSettings.showNarrationText && caption ? (
        <div
          style={{
            position: "absolute",
            bottom: 48,
            width: "100%",
            textAlign: "center",
            fontSize: 36,
          }}
        >
          {caption.text}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
