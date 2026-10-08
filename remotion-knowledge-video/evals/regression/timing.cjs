const FPS = 60;
const clamp = (value) => Math.max(0, Math.min(1, value));
const frameAt = (seconds, fps = FPS) => Math.round(seconds * fps);

function audioCoverage(
  audioStartSeconds,
  retainedAudioSeconds,
  fps = FPS,
  extraTailSeconds = 0,
) {
  for (const value of [
    audioStartSeconds,
    retainedAudioSeconds,
    extraTailSeconds,
  ]) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error("Invalid duration");
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Invalid fps");
  const startFrame = frameAt(audioStartSeconds, fps);
  const placedEndSeconds = startFrame / fps + retainedAudioSeconds;
  return {
    startFrame,
    placedEndSeconds,
    totalFrames: Math.ceil((placedEndSeconds + extraTailSeconds) * fps),
  };
}

// This fixture's speech exclusions come from its user prompt, not a general heuristic.
const spokenParagraphs = (section) =>
  section.paragraphs.filter((paragraph) => !/^[\uff08(]/u.test(paragraph));

function speechBudget(text, rate = 4, includesPauses = false) {
  const chinese = [...text.matchAll(/\p{Script=Han}/gu)].length;
  const english = [...text.matchAll(/[A-Za-z]+/g)].length;
  const pauses = includesPauses
    ? 0
    : [...text.matchAll(/[\uff0c,\uff1b;\uff1a:]/g)].length * 0.2 +
      [...text.matchAll(/[\u3002.!\uff01?\uff1f]/g)].length * 0.4;
  return chinese / rate + english / 2.5 + pauses;
}

function buildPlans(sections, { rate = 4, includesPauses = false } = {}) {
  const specifications = [
    {
      kind: "expansion",
      phrases: [
        "\u7b2c\u4e00\u6b21\u7ebf\u6027\u53d8\u6362",
        "token \u6570\u91cf\u4fdd\u6301\u4e0d\u53d8",
      ],
    },
    {
      kind: "activation",
      phrases: [
        "\u8d1f\u6570\u53d8\u6210\u96f6",
        "\u5982\u679c\u53bb\u6389\u6fc0\u6d3b\u51fd\u6570",
        "\u52a0\u5165\u975e\u7ebf\u6027\u4e4b\u540e",
      ],
    },
    {
      kind: "projection",
      phrases: [
        "\u6620\u5c04\u56de\u4e00\u767e\u4e8c\u5341\u516b\u7ef4",
        "\u603b\u7ed3\u4e00\u4e0b",
      ],
    },
  ];
  const spoken = sections.filter(
    (section) => spokenParagraphs(section).length > 0,
  );
  if (spoken.length !== 3)
    throw new Error("Expected the three-section evaluation fixture");
  return spoken.map((section, index) => {
    const text = spokenParagraphs(section).join("\n");
    const estimate = (value) => speechBudget(value, rate, includesPauses);
    const seconds = estimate(text);
    const totalFrames = Math.max(1, frameAt(seconds));
    const holdFrames = Math.min(frameAt(1.5), Math.floor(totalFrames / 5));
    const cues = specifications[index].phrases.map((phrase) => {
      const offset = text.indexOf(phrase);
      if (offset < 0) throw new Error("Missing phrase");
      const targetSeconds = estimate(text.slice(0, offset));
      return { phrase, targetSeconds, startFrame: frameAt(targetSeconds) };
    });
    return {
      id: `Batch-${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      ...specifications[index],
      title: section.title,
      sourceStart: section.start,
      sourceEnd: section.end,
      raw: section.raw,
      spokenText: text,
      estimatedSeconds: seconds,
      totalFrames,
      fps: FPS,
      holdFrames,
      cues,
      rate,
      includesPauses,
    };
  });
}

function stateAt(frame, plan) {
  const stableFrame = Math.min(frame, plan.totalFrames - plan.holdFrames);
  return {
    actions: plan.cues.map((cue) =>
      clamp((stableFrame - cue.startFrame) / Math.round(0.8 * plan.fps)),
    ),
  };
}

module.exports = {
  FPS,
  frameAt,
  audioCoverage,
  speechBudget,
  buildPlans,
  stateAt,
};
