const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { splitTranscript } = require("./split-transcript.cjs");
const { frameAt, audioCoverage, buildPlans, stateAt } = require("./timing.cjs");
const { reserveBatch, renderBatch, sha256 } = require("./batch-output.cjs");
const ts = require("typescript");
const React = require("react");

function loadClip() {
  const extensions = [".ts", ".tsx"];
  const previous = extensions.map((extension) => require.extensions[extension]);
  try {
    for (const extension of extensions) {
      require.extensions[extension] = (module, file) => {
        const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        });
        module._compile(compiled.outputText, file);
      };
    }
    return require("./Clip.tsx");
  } finally {
    extensions.forEach((extension, index) => {
      if (previous[index]) require.extensions[extension] = previous[index];
      else delete require.extensions[extension];
    });
  }
}

const { Diagram } = loadClip();

function textOpacities(element, opacity = 1, labels = new Map()) {
  React.Children.forEach(element, (child) => {
    if (!React.isValidElement(child)) return;
    const effectiveOpacity = opacity * Number(child.props.opacity ?? 1);
    if (child.type === "text") {
      labels.set(child.props.children, effectiveOpacity);
    }
    textOpacities(child.props.children, effectiveOpacity, labels);
  });
  return labels;
}

const gridModule = {};
new Function(
  "exports",
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../../assets/template/grid-motion.ts"),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
)(gridModule);

const fixture = (name) =>
  fs.readFileSync(
    path.join(__dirname, "../fixtures/batch-transcript", name),
    "utf8",
  );

test("source slices retain the three raw sections and ignore two empty sections", async () => {
  const source = fixture("transcript.md");
  const { metadataEnd, sections } = await splitTranscript(source);
  assert.ok(metadataEnd > 0);
  assert.equal(sections.filter((section) => section.empty).length, 2);
  const plans = buildPlans(sections);
  assert.deepEqual(
    plans.map((plan) => plan.title),
    ["Expansion", "Nonlinear activation", "Projection"],
  );
  for (const plan of plans) {
    assert.equal(plan.raw, source.slice(plan.sourceStart, plan.sourceEnd));
    assert.ok(plan.spokenText.length > 0);
  }
  assert.ok(plans[0].raw.includes("```text\n---"));
  assert.ok(plans[1].raw.includes("Nonlinear activation\n---"));
  assert.ok(plans[1].raw.includes("~~~text\n***"));
});

test("a leading rule without YAML cannot swallow speech through a fenced rule", async () => {
  const source = fixture("leading-rule.md");
  const result = await splitTranscript(source);
  assert.equal(result.metadataEnd, 0);
  assert.equal(result.sections.filter((section) => !section.empty).length, 2);
  assert.equal(result.sections.filter((section) => section.empty).length, 1);
  assert.deepEqual(
    result.sections.flatMap((section) => section.paragraphs),
    ["First spoken paragraph.", "Second spoken paragraph."],
  );
});

test("YAML-shaped leading speech is preserved with BOM and CRLF variants", async () => {
  const original = fixture("leading-mapping.md");
  for (const source of [
    original,
    "\uFEFF" + original,
    original.replaceAll("\n", "\r\n"),
    "\uFEFF" + original.replaceAll("\n", "\r\n"),
  ]) {
    const { metadataEnd, sections } = await splitTranscript(source);
    assert.equal(metadataEnd, 0);
    assert.equal(sections.filter((section) => !section.empty).length, 2);
    assert.deepEqual(
      sections.flatMap((section) => section.paragraphs),
      ["Speaker: First sentence", "Second sentence."],
    );
    for (const section of sections) {
      assert.equal(section.raw, source.slice(section.start, section.end));
    }
  }
});

test("unknown, mixed or non-string metadata fields cannot discard narration", async () => {
  for (const mapping of [
    "title: A topic\nSpeaker: First sentence",
    "title: [Spoken, sentence]",
    "language: 42",
    "title: ''",
  ]) {
    const source = `---\n${mapping}\n\n---\n\nSecond sentence.\n`;
    const { metadataEnd, sections } = await splitTranscript(source);
    assert.equal(metadataEnd, 0);
    const spoken = sections.filter((section) => !section.empty);
    assert.equal(spoken.length, 2);
    assert.ok(spoken[0].raw.includes(mapping));
    assert.ok(spoken[0].paragraphs.length > 0);
  }
});

test("nested rules, code, HTML and Setext underlines do not create clips", async () => {
  for (const source of [
    "First.\n---\n\nSecond.",
    "> Quoted.\n>\n> ---\n\nNarration.",
    "- Item.\n\n  ---\n\nNarration.",
    "    ---\n\nNarration.",
    "<div>\n---\n</div>\n\nNarration.",
    "~~~text\n***\n~~~\n\nNarration.",
  ]) {
    const result = await splitTranscript(source);
    assert.equal(result.sections.filter((section) => !section.empty).length, 1);
  }
});

test("no rule means one clip; heading-only segments have no invented speech", async () => {
  const single = await splitTranscript("One spoken paragraph.\n");
  assert.equal(single.sections.length, 1);
  const titleOnly = await splitTranscript("# Chapter\n\n---\n\nSpoken body.\n");
  assert.equal(titleOnly.sections.length, 2);
  assert.deepEqual(titleOnly.sections[0].paragraphs, []);
  assert.deepEqual(titleOnly.sections[1].paragraphs, ["Spoken body."]);
});

test("fractional audio ends are covered at 30, 60 and 59.94 fps", () => {
  for (const fps of [30, 60, 59.94]) {
    for (const seconds of [12.004, 25.501, 38.401]) {
      for (const offset of [0, 0.004, 0.8]) {
        const timing = audioCoverage(offset, seconds, fps);
        assert.ok(timing.totalFrames / fps >= timing.placedEndSeconds);
        assert.ok(timing.totalFrames / fps - timing.placedEndSeconds < 1 / fps);
      }
    }
    assert.throws(() => audioCoverage(0, -1, fps));
  }
  assert.ok(frameAt(12.004, 60) / 60 < 12.004);
});

test("absolute cue boundaries avoid accumulated segment rounding", () => {
  const boundaries = [0, 0.014, 0.028, 0.042, 0.056].map((value) =>
    frameAt(value),
  );
  const durations = boundaries
    .slice(1)
    .map((end, index) => end - boundaries[index]);
  assert.equal(
    durations.reduce((sum, duration) => sum + duration, 0),
    frameAt(0.056),
  );
});

function verifyProgress(plans, state) {
  for (const plan of plans) {
    for (const [index, cue] of plan.cues.entries()) {
      assert.equal(state(cue.startFrame, plan).actions[index], 0);
      assert.ok(state(cue.startFrame + 1, plan).actions[index] > 0);
      assert.equal(
        state(cue.startFrame + frameAt(0.8), plan).actions[index],
        1,
      );
    }
    const holdStart = plan.totalFrames - plan.holdFrames;
    const reference = state(holdStart, plan);
    assert.ok(reference.actions.every((value) => value === 1));
    for (let frame = holdStart; frame < plan.totalFrames; frame++) {
      assert.deepEqual(state(frame, plan), reference);
    }
  }
}

test("rendered action state follows each estimated keyword and freezes throughout the hold", async () => {
  const { sections } = await splitTranscript(fixture("transcript.md"));
  const plans = buildPlans(sections);
  verifyProgress(plans, stateAt);
  assert.throws(() => verifyProgress(plans, () => ({ actions: [1, 1, 1] })));
  assert.equal(new Set(plans.map((plan) => plan.totalFrames)).size, 3);
});

const resultLabels = {
  expansion: [["512 features"], ["Same token count"]],
  activation: [
    ["ReLU(x) = max(0, x)"],
    ["Without activation", "W2(W1x + b1) + b2", "= Ax + b"],
    ["Nonlinearity adds expressive power"],
  ],
  projection: [
    ["128 features", "Ready for residual addition"],
    ["Expand  /  Activate  /  Project"],
  ],
};

for (const [kind, groups] of Object.entries(resultLabels)) {
  test(`${kind} SVG labels reveal only with their corresponding narration cue`, async () => {
    const { sections } = await splitTranscript(fixture("transcript.md"));
    const plan = buildPlans(sections).find((entry) => entry.kind === kind);
    for (const [index, cue] of plan.cues.entries()) {
      for (const offset of [-1, 0, 1, frameAt(0.8)]) {
        const actions = stateAt(cue.startFrame + offset, plan).actions;
        const labels = textOpacities(Diagram({ kind, actions }));
        for (const label of groups[index]) {
          assert.equal(labels.get(label), actions[index], label);
        }
        if (kind === "expansion") assert.equal(labels.get("128 features"), 1);
        if (kind === "projection") assert.equal(labels.get("512 features"), 1);
      }
    }
  });
}

test("a new batch cannot overwrite an existing session directory", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-batch-"));
  try {
    const first = reserveBatch(parent, "sample");
    fs.writeFileSync(path.join(first, "old.mp4"), "existing output");
    const digest = sha256(path.join(first, "old.mp4"));
    const second = reserveBatch(parent, "sample");
    assert.notEqual(first, second);
    assert.equal(sha256(path.join(first, "old.mp4")), digest);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("the actual background calculation is stationary for every ending hold frame", async () => {
  const { sections } = await splitTranscript(fixture("transcript.md"));
  for (const plan of buildPlans(sections)) {
    const position = (frame) =>
      gridModule.getGridTravelSeconds(
        frame / plan.fps,
        plan.totalFrames / plan.fps,
        plan.holdFrames / plan.fps,
      );
    const holdStart = plan.totalFrames - plan.holdFrames;
    for (let frame = holdStart; frame < plan.totalFrames; frame++) {
      assert.equal(position(frame), position(holdStart));
    }
    assert.ok(position(holdStart - 60) < position(holdStart));
  }
});

test("a changed plan cannot silently reuse a completed output", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-input-"));
  try {
    const directory = reserveBatch(parent, "sample");
    const plans = [{ id: "Test-1", duration: 1 }];
    const render = async (plan, file) =>
      fs.writeFileSync(file, "encoded output");
    await renderBatch(directory, plans, render, async () => ({
      decoded: true,
    }));
    const digest = sha256(path.join(directory, "Test-1.mp4"));
    await assert.rejects(() =>
      renderBatch(
        directory,
        [{ id: "Test-1", duration: 2 }],
        render,
        async () => ({}),
      ),
    );
    assert.equal(sha256(path.join(directory, "Test-1.mp4")), digest);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

const batchChanges = {
  addition: (plans) => [...plans, { id: "Test-4", duration: 1 }],
  removal: (plans) => plans.slice(0, -1),
  reordering: (plans) => plans.toReversed(),
  "later input change": (plans) =>
    plans.map((plan, index) => (index === 2 ? { ...plan, duration: 2 } : plan)),
};

for (const [change, modify] of Object.entries(batchChanges)) {
  test(`batch ${change} is rejected before rendering or changing any output`, async () => {
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "knowledge-plan-set-"),
    );
    const plans = [1, 2, 3].map((order) => ({
      id: `Test-${order}`,
      duration: 1,
    }));
    const calls = [];
    const render = async (plan, file) => {
      calls.push(plan.id);
      fs.writeFileSync(file, plan.id);
    };
    try {
      const directory = reserveBatch(parent, "sample");
      await renderBatch(directory, plans, render, async () => ({
        decoded: true,
      }));
      const snapshot = () =>
        Object.fromEntries(
          fs
            .readdirSync(directory)
            .map((file) => [file, sha256(path.join(directory, file))]),
        );
      const before = snapshot();
      calls.length = 0;
      await assert.rejects(
        () => renderBatch(directory, modify(plans), render, async () => ({})),
        /reserve a new batch/,
      );
      assert.deepEqual(calls, []);
      assert.deepEqual(snapshot(), before);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
}

test("the full plan is registered before the first clip completes", async () => {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-plan-start-"),
  );
  const plans = [1, 2].map((order) => ({ id: `Test-${order}` }));
  try {
    const directory = reserveBatch(parent, "sample");
    const render = async (plan, file) => {
      if (plan.id === "Test-1") {
        const manifestPath = path.join(directory, "manifest.json");
        const before = fs.readFileSync(manifestPath, "utf8");
        assert.deepEqual(JSON.parse(before).clips, {});
        await assert.rejects(
          () => renderBatch(directory, [plans[0]], render, async () => ({})),
          /reserve a new batch/,
        );
        assert.equal(fs.readFileSync(manifestPath, "utf8"), before);
      }
      fs.writeFileSync(file, plan.id);
    };
    const manifest = await renderBatch(
      directory,
      plans,
      render,
      async () => ({}),
    );
    assert.ok(
      Object.values(manifest.clips).every((clip) => clip.status === "complete"),
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("a legacy manifest without the full plan identity fails without mutation", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-legacy-"));
  try {
    const directory = reserveBatch(parent, "sample");
    const manifestPath = path.join(directory, "manifest.json");
    const before = JSON.stringify({ clips: {} });
    fs.writeFileSync(manifestPath, before);
    let rendered = false;
    await assert.rejects(
      () =>
        renderBatch(
          directory,
          [{ id: "Test-1" }],
          async () => {
            rendered = true;
          },
          async () => ({}),
        ),
      /reserve a new batch/,
    );
    assert.equal(rendered, false);
    assert.equal(fs.readFileSync(manifestPath, "utf8"), before);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("retry renders only a failed clip and preserves completed files", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-retry-"));
  const plans = [1, 2, 3].map((order) => ({ id: `Test-${order}`, order }));
  let fail = true;
  const calls = [];
  const render = async (plan, file) => {
    calls.push(plan.id);
    if (fail && plan.order === 2) throw new Error("Injected render failure");
    fs.writeFileSync(file, plan.id);
  };
  try {
    const directory = reserveBatch(parent, "sample");
    const first = await renderBatch(directory, plans, render, async () => ({
      decoded: true,
    }));
    assert.equal(first.clips["Test-2"].status, "failed");
    const firstHash = sha256(path.join(directory, "Test-1.mp4"));
    const thirdHash = sha256(path.join(directory, "Test-3.mp4"));
    fail = false;
    calls.length = 0;
    const second = await renderBatch(directory, plans, render, async () => ({
      decoded: true,
    }));
    assert.deepEqual(calls, ["Test-2"]);
    assert.ok(
      Object.values(second.clips).every((clip) => clip.status === "complete"),
    );
    assert.equal(sha256(path.join(directory, "Test-1.mp4")), firstHash);
    assert.equal(sha256(path.join(directory, "Test-3.mp4")), thirdHash);
    assert.ok(
      !fs.readdirSync(directory).some((file) => file.includes(".pending.")),
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
