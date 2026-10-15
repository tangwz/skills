import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  KnowledgeBackground,
  KnowledgeContent,
} from "../../assets/template/VideoChrome";
import {
  type LocalVideoFont,
  getCanvasScale,
  getContentBottomInset,
  VIDEO_FONT_ROLES,
  VIDEO_STYLE,
  useLocalVideoFonts,
} from "../../assets/template/video-style";
import { stateAt } from "./timing.cjs";

type ChineseFontFormat = "truetype" | "collection";

export const fontSourcesFor = (
  chineseFontFormat: ChineseFontFormat,
): readonly LocalVideoFont[] => [
  { role: "title", path: "title.woff2", weight: "700", format: "woff2" },
  { role: "body", path: "body.woff2", weight: "500", format: "woff2" },
  {
    role: "chinese",
    path: "chinese.ttf",
    weight: "400 700",
    format: chineseFontFormat,
  },
  { role: "mono", path: "mono.woff2", weight: "500", format: "woff2" },
];

type Plan = {
  id: string;
  kind: string;
  title: string;
  fps: number;
  totalFrames: number;
  holdFrames: number;
  transitionFrames: number;
  cues: { phrase: string; startFrame: number; targetSeconds: number }[];
};

export function Diagram({
  kind,
  actions,
  contentBottom = VIDEO_STYLE.canvas.height -
    getContentBottomInset(VIDEO_STYLE.canvas.width, VIDEO_STYLE.canvas.height),
}: {
  kind: string;
  actions: number[];
  contentBottom?: number;
}) {
  const { ink, muted, cyan, orange } = VIDEO_STYLE.colors;
  // Reflow vertical spacing while keeping text at its original size.
  const diagramScale = Math.min(1, (contentBottom - 410) / 480);
  const y = (position: number) => 300 + (position - 300) * diagramScale;
  const conclusionY = contentBottom - 24;
  const label = (x: number, y: number, value: string, color = muted) => (
    <text x={x} y={y} fill={color} textAnchor="middle" fontSize={42}>
      {value}
    </text>
  );
  if (kind === "expansion") {
    return (
      <g>
        {[0, 1, 2, 3].map((index) => (
          <rect
            key={index}
            x={260 + index * 52}
            y={y(385)}
            width={38}
            height={240 * diagramScale}
            rx={10}
            fill={cyan}
          />
        ))}
        <path
          d={`M 560 ${y(505)} H 820 L 780 ${y(465)} M 820 ${y(505)} L 780 ${y(545)}`}
          stroke={cyan}
          strokeWidth={8}
          fill="none"
          opacity={actions[0]}
        />
        <g opacity={actions[0]}>
          {Array.from({ length: 16 }, (_, index) => (
            <rect
              key={index}
              x={910 + index * 36}
              y={y(385)}
              width={24}
              height={240 * diagramScale}
              rx={6}
              fill={cyan}
            />
          ))}
          {label(1190, y(705), "512 features")}
        </g>
        {label(355, y(705), "128 features")}
        <g opacity={actions[1]}>
          {label(960, conclusionY, "Same token count", orange)}
        </g>
      </g>
    );
  }
  if (kind === "activation") {
    return (
      <g>
        <path
          d={`M 320 ${y(680)} H 890 M 490 ${y(710)} V ${y(310)}`}
          stroke={muted}
          strokeWidth={4}
          fill="none"
        />
        <g opacity={actions[0]}>
          <path
            d={`M 330 ${y(680)} H 490 L 830 ${y(340)}`}
            stroke={cyan}
            strokeWidth={10}
            fill="none"
          />
          {label(570, y(780), "ReLU(x) = max(0, x)")}
        </g>
        <g opacity={actions[1]}>
          {label(1280, y(455), "Without activation")}
          {label(1280, y(545), "W2(W1x + b1) + b2", ink)}
          {label(1280, y(625), "= Ax + b", orange)}
        </g>
        <g opacity={actions[2]}>
          {label(960, conclusionY, "Nonlinearity adds expressive power", cyan)}
        </g>
      </g>
    );
  }
  return (
    <g>
      <rect
        x={270}
        y={y(375)}
        width={500}
        height={240 * diagramScale}
        rx={25}
        fill={cyan}
        opacity={0.4}
      />
      {label(520, y(510), "512 features", ink)}
      <path
        d={`M 830 ${y(505)} H 1090 L 1050 ${y(465)} M 1090 ${y(505)} L 1050 ${y(545)}`}
        stroke={orange}
        strokeWidth={8}
        fill="none"
        opacity={actions[0]}
      />
      <g opacity={actions[0]}>
        <rect
          x={1160}
          y={y(375)}
          width={350}
          height={240 * diagramScale}
          rx={25}
          stroke={orange}
          strokeWidth={6}
          fill="none"
        />
        {label(1335, y(510), "128 features", ink)}
        {label(1335, y(715), "Ready for residual addition")}
      </g>
      <g opacity={actions[1]}>
        {label(960, conclusionY, "Expand  /  Activate  /  Project", cyan)}
      </g>
    </g>
  );
}

export function Clip({
  plan,
  chineseFontFormat,
}: {
  plan: Plan;
  chineseFontFormat: ChineseFontFormat;
}) {
  useLocalVideoFonts(VIDEO_FONT_ROLES, fontSourcesFor(chineseFontFormat));
  const state = stateAt(useCurrentFrame(), plan);
  const { width, height } = useVideoConfig();
  const scale = getCanvasScale(width, height);
  const inset = VIDEO_STYLE.layout.safeMargin;
  const contentBottom = (height - getContentBottomInset(width, height)) / scale;
  return (
    <AbsoluteFill>
      <KnowledgeBackground holdSeconds={plan.holdFrames / plan.fps} />
      <KnowledgeContent>
        <svg
          viewBox={`${inset} ${inset} ${width / scale - 2 * inset} ${contentBottom - inset}`}
          style={{ width: "100%", height: "100%", position: "absolute" }}
        >
          <g fontFamily={VIDEO_FONT_ROLES.body}>
            <text
              x={100}
              y={130}
              fill={VIDEO_STYLE.colors.cyan}
              fontSize={30}
              letterSpacing={4}
            >
              FEED-FORWARD NETWORK
            </text>
            <text
              x={100}
              y={235}
              fill={VIDEO_STYLE.colors.ink}
              fontFamily={VIDEO_FONT_ROLES.title}
              fontSize={70}
            >
              {plan.title}
            </text>
            <Diagram
              kind={plan.kind}
              actions={state.actions}
              contentBottom={contentBottom}
            />
          </g>
        </svg>
      </KnowledgeContent>
    </AbsoluteFill>
  );
}

export function AudioCoverageClip({ startFrame }: { startFrame: number }) {
  return (
    <AbsoluteFill style={{ background: "#111111" }}>
      <Sequence from={startFrame}>
        <Audio src={staticFile("tail-signal.wav")} />
      </Sequence>
    </AbsoluteFill>
  );
}

export function RenderRoot({
  plans,
  audioTest,
  chineseFontFormat,
}: {
  plans: Plan[];
  audioTest: { startFrame: number; totalFrames: number };
  chineseFontFormat: ChineseFontFormat;
}) {
  return (
    <>
      {plans.map((plan) => (
        <Composition
          key={plan.id}
          id={plan.id}
          component={Clip}
          width={640}
          height={360}
          fps={plan.fps}
          durationInFrames={plan.totalFrames}
          defaultProps={{ plan, chineseFontFormat }}
        />
      ))}
      <Composition
        id="AudioCoverage"
        component={AudioCoverageClip}
        width={320}
        height={180}
        fps={60}
        durationInFrames={audioTest.totalFrames}
        defaultProps={{ startFrame: audioTest.startFrame }}
      />
    </>
  );
}
