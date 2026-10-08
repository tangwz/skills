import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { KnowledgeBackground } from "../../assets/template/VideoChrome";
import {
  VIDEO_FONT_ROLES,
  VIDEO_STYLE,
  useLocalVideoFonts,
} from "../../assets/template/video-style";
import { stateAt } from "./timing.cjs";

const fontSources = [
  { role: "title", path: "title.woff2", weight: "700" },
  { role: "body", path: "body.woff2", weight: "500" },
  { role: "chinese", path: "chinese.ttf", weight: "400 700" },
  { role: "mono", path: "mono.woff2", weight: "500" },
] as const;

type Plan = {
  id: string;
  kind: string;
  title: string;
  fps: number;
  totalFrames: number;
  holdFrames: number;
  cues: { phrase: string; startFrame: number; targetSeconds: number }[];
};

function Diagram({ kind, actions }: { kind: string; actions: number[] }) {
  const { ink, muted, cyan, orange } = VIDEO_STYLE.colors;
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
            y={385}
            width={38}
            height={240}
            rx={10}
            fill={cyan}
          />
        ))}
        <path
          d="M 560 505 H 820 L 780 465 M 820 505 L 780 545"
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
              y={385}
              width={24}
              height={240}
              rx={6}
              fill={cyan}
            />
          ))}
        </g>
        {label(355, 705, "128 features")}
        {label(1190, 705, "512 features")}
        <g opacity={actions[1]}>
          {label(960, 845, "Same token count", orange)}
        </g>
      </g>
    );
  }
  if (kind === "activation") {
    return (
      <g>
        <path
          d="M 320 680 H 890 M 490 710 V 310"
          stroke={muted}
          strokeWidth={4}
          fill="none"
        />
        <path
          d="M 330 680 H 490 L 830 340"
          stroke={cyan}
          strokeWidth={10}
          fill="none"
          opacity={actions[0]}
        />
        {label(570, 780, "ReLU(x) = max(0, x)")}
        <g opacity={actions[1]}>
          {label(1280, 455, "Without activation")}
          {label(1280, 545, "W2(W1x + b1) + b2", ink)}
          {label(1280, 625, "= Ax + b", orange)}
        </g>
        <g opacity={actions[2]}>
          {label(960, 885, "Nonlinearity adds expressive power", cyan)}
        </g>
      </g>
    );
  }
  return (
    <g>
      <rect
        x={270}
        y={375}
        width={500}
        height={240}
        rx={25}
        fill={cyan}
        opacity={0.4}
      />
      {label(520, 510, "512 features", ink)}
      <path
        d="M 830 505 H 1090 L 1050 465 M 1090 505 L 1050 545"
        stroke={orange}
        strokeWidth={8}
        fill="none"
        opacity={actions[0]}
      />
      <g opacity={actions[0]}>
        <rect
          x={1160}
          y={375}
          width={350}
          height={240}
          rx={25}
          stroke={orange}
          strokeWidth={6}
          fill="none"
        />
        {label(1335, 510, "128 features", ink)}
        {label(1335, 715, "Ready for residual addition")}
      </g>
      <g opacity={actions[1]}>
        {label(960, 880, "Expand  /  Activate  /  Project", cyan)}
      </g>
    </g>
  );
}

export function Clip({ plan }: { plan: Plan }) {
  useLocalVideoFonts(VIDEO_FONT_ROLES, fontSources);
  const state = stateAt(useCurrentFrame(), plan);
  return (
    <AbsoluteFill>
      <KnowledgeBackground holdSeconds={plan.holdFrames / plan.fps} />
      <svg
        viewBox="0 0 1920 1080"
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
          <Diagram kind={plan.kind} actions={state.actions} />
        </g>
      </svg>
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
}: {
  plans: Plan[];
  audioTest: { startFrame: number; totalFrames: number };
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
          defaultProps={{ plan }}
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
