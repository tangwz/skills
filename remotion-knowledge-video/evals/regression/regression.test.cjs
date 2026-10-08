const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
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

test("nested list and quote paragraphs preserve narration order while excluding code and HTML", async () => {
  const source = fixture("nested-narration.md");
  const { sections } = await splitTranscript(source);
  assert.equal(sections.length, 3);
  assert.deepEqual(
    sections.map((section) => section.paragraphs),
    [
      ["First list sentence.", "Nested list sentence.", "Last list sentence."],
      [
        "First quoted sentence.",
        "Quoted list sentence.",
        "Last quoted sentence.",
      ],
      ["Final list sentence.", "Final continuation."],
    ],
  );
  for (const section of sections) {
    assert.equal(section.raw, source.slice(section.start, section.end));
  }
});

test("list-only and quote-only narration still produces all three timed plans", async () => {
  const original = await splitTranscript(fixture("transcript.md"));
  const originalPlans = buildPlans(original.sections);
  const nestedSource = originalPlans
    .map((plan, index) => {
      const lines = plan.spokenText.split("\n");
      const body =
        index === 0
          ? lines.map((line) => `- ${line}`).join("\n\n")
          : lines
              .map((line) => `${index === 1 ? "> " : "> - "}${line}`)
              .join("\n>\n") + "\n>\n> ---";
      return `# ${plan.title}\n\n${body}`;
    })
    .join("\n\n---\n\n");
  const nested = await splitTranscript(nestedSource);
  const summary = (plans) =>
    plans.map(({ id, title, spokenText, cues, totalFrames }) => ({
      id,
      title,
      spokenText,
      cues,
      totalFrames,
    }));
  assert.deepEqual(
    summary(buildPlans(nested.sections)),
    summary(originalPlans),
  );
});

test("no rule means one clip; heading-only segments have no invented speech", async () => {
  const single = await splitTranscript("One spoken paragraph.\n");
  assert.equal(single.sections.length, 1);
  const titleOnly = await splitTranscript("# Chapter\n\n---\n\nSpoken body.\n");
  assert.equal(titleOnly.sections.length, 2);
  assert.deepEqual(titleOnly.sections[0].paragraphs, []);
  assert.deepEqual(titleOnly.sections[1].paragraphs, ["Spoken body."]);
});

test("unspoken heading, stage-direction and code sections do not create extra plans", async () => {
  const source = fixture("transcript.md");
  const withUnspoken = source.replace(
    "# Expansion",
    [
      "# Silent chapter",
      "",
      "---",
      "",
      "(Stage direction only.)",
      "",
      "---",
      "",
      "~~~text",
      "value = 512",
      "~~~",
      "",
      "---",
      "",
      "# Expansion",
    ].join("\n"),
  );
  assert.notEqual(withUnspoken, source);
  const original = await splitTranscript(source);
  const expanded = await splitTranscript(withUnspoken);
  assert.equal(expanded.sections.length, original.sections.length + 3);
  const summary = (sections) =>
    buildPlans(sections).map(({ id, title, spokenText, totalFrames }) => ({
      id,
      title,
      spokenText,
      totalFrames,
    }));
  assert.deepEqual(summary(expanded.sections), summary(original.sections));
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

test("frame-aligned audio and tails do not acquire a roundoff frame", () => {
  for (const fps of [30, 60, 59.94]) {
    for (const frames of [1, 2, 7, 31, 97, 131, 241, 997, 4096, 65535]) {
      for (const offset of [0, 0.004, 0.8, 12000.123]) {
        for (const tailFrames of [0, 1, 31]) {
          const timing = audioCoverage(
            offset,
            frames / fps,
            fps,
            tailFrames / fps,
          );
          assert.equal(
            timing.totalFrames,
            timing.startFrame + frames + tailFrames,
          );
        }
      }
    }
  }
  assert.equal(audioCoverage(0, 31 / 60, 60).totalFrames, 31);
});

test("genuine fractional audio and declared tails still round up", () => {
  for (const fps of [30, 60, 59.94]) {
    for (const frames of [1, 31, 241, 997]) {
      for (const fraction of [1e-8, 0.001, 0.24, 0.99999999]) {
        for (const offset of [0, 0.004, 0.8, 12000.123]) {
          const audio = audioCoverage(offset, (frames + fraction) / fps, fps);
          const tail = audioCoverage(offset, frames / fps, fps, fraction / fps);
          assert.equal(audio.totalFrames, audio.startFrame + frames + 1);
          assert.equal(tail.totalFrames, tail.startFrame + frames + 1);
        }
      }
    }
  }
});

test("a positive sub-frame span cannot be rounded to zero", () => {
  for (const fps of [30, 60, 59.94]) {
    for (const offset of [0, 0.004, 0.8, 12000.123]) {
      for (const seconds of [Number.EPSILON / 100, 1e-10, 1 / 48000]) {
        const audio = audioCoverage(offset, seconds, fps);
        const tail = audioCoverage(offset, 0, fps, seconds);
        assert.equal(audio.totalFrames, audio.startFrame + 1);
        assert.equal(tail.totalFrames, tail.startFrame + 1);
      }
      const empty = audioCoverage(offset, 0, fps);
      assert.equal(empty.totalFrames, empty.startFrame);
    }
  }
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
  reordering: (plans) => [...plans].reverse(),
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

function interruptPublication(directory, plans, phase) {
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `
        const fs = require("node:fs");
        const path = require("node:path");
        const { renderBatch } = require(process.argv[1]);
        const directory = process.argv[2];
        const plans = JSON.parse(process.argv[3]);
        const phase = process.argv[4];
        const target = path.join(directory, "Test-2.mp4");
        const manifestTemporary = path.join(directory, "manifest.json.pending");
        const rename = fs.renameSync;
        fs.renameSync = (from, to) => {
          if (to === target && phase === "before-publish") process.exit(91);
          rename(from, to);
          if (to === target && phase === "after-publish") process.exit(91);
        };
        const write = fs.writeFileSync;
        fs.writeFileSync = (file, data, ...options) => {
          if (file === manifestTemporary && phase === "during-completion-save" &&
              JSON.parse(data).clips["Test-2"]?.status === "complete") {
            write(file, '{"clips":');
            process.exit(91);
          }
          return write(file, data, ...options);
        };
        renderBatch(
          directory,
          plans,
          async (plan, file) => fs.writeFileSync(file, plan.id),
          async () => ({ decoded: true }),
        ).catch((error) => { console.error(error); process.exitCode = 1; });
      `,
      require.resolve("./batch-output.cjs"),
      directory,
      JSON.stringify(plans),
      phase,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 91, child.stderr);
}

for (const phase of [
  "before-publish",
  "after-publish",
  "during-completion-save",
]) {
  test(`a process exit ${phase} resumes without re-encoding verified clips`, async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-publish-"));
    const plans = [1, 2, 3].map((order) => ({ id: `Test-${order}` }));
    try {
      const directory = reserveBatch(parent, "sample");
      interruptPublication(directory, plans, phase);
      const manifestPath = path.join(directory, "manifest.json");
      const checkpoint = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      assert.equal(checkpoint.clips["Test-1"].status, "complete");
      assert.equal(checkpoint.clips["Test-2"].status, "ready");
      assert.equal(checkpoint.clips["Test-3"], undefined);
      const firstHash = sha256(path.join(directory, "Test-1.mp4"));
      const candidate = path.join(
        directory,
        phase === "before-publish" ? "Test-2.pending.mp4" : "Test-2.mp4",
      );
      const secondHash = sha256(candidate);
      const rendered = [];
      const verified = [];
      const manifest = await renderBatch(
        directory,
        plans,
        async (plan, file) => {
          rendered.push(plan.id);
          fs.writeFileSync(file, plan.id);
        },
        async (plan) => {
          verified.push(plan.id);
          return { decoded: true };
        },
      );
      assert.deepEqual(rendered, ["Test-3"]);
      assert.deepEqual(verified, ["Test-3"]);
      assert.equal(sha256(path.join(directory, "Test-1.mp4")), firstHash);
      assert.equal(sha256(path.join(directory, "Test-2.mp4")), secondHash);
      for (const plan of plans) {
        assert.equal(manifest.clips[plan.id].status, "complete");
        assert.equal(manifest.clips[plan.id].media.decoded, true);
      }
      assert.deepEqual(
        JSON.parse(fs.readFileSync(manifestPath, "utf8")),
        manifest,
      );
      assert.ok(
        !fs.readdirSync(directory).some((file) => file.includes(".pending")),
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
}

for (const phase of ["before-publish", "after-publish"]) {
  test(`a changed ready file from ${phase} is rejected without mutation`, async () => {
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "knowledge-ready-hash-"),
    );
    const plans = [1, 2, 3].map((order) => ({ id: `Test-${order}` }));
    try {
      const directory = reserveBatch(parent, "sample");
      interruptPublication(directory, plans, phase);
      const candidate = path.join(
        directory,
        phase === "before-publish" ? "Test-2.pending.mp4" : "Test-2.mp4",
      );
      fs.writeFileSync(candidate, "changed externally");
      const snapshot = () =>
        Object.fromEntries(
          fs
            .readdirSync(directory)
            .map((file) => [file, sha256(path.join(directory, file))]),
        );
      const before = snapshot();
      await assert.rejects(
        () =>
          renderBatch(
            directory,
            plans,
            async () => assert.fail("Unexpected render"),
            async () => assert.fail("Unexpected verification"),
          ),
        /Ready output is missing or changed/,
      );
      assert.deepEqual(snapshot(), before);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
}

test("a final file without a verified ready record cannot be adopted", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-untracked-"));
  const plans = [{ id: "Test-1" }];
  try {
    const directory = reserveBatch(parent, "sample");
    await renderBatch(
      directory,
      plans,
      async () => {
        throw new Error("Injected render failure");
      },
      async () => ({}),
    );
    const file = path.join(directory, "Test-1.mp4");
    fs.writeFileSync(file, "untracked output");
    const manifestPath = path.join(directory, "manifest.json");
    const manifestHash = sha256(manifestPath);
    const fileHash = sha256(file);
    await assert.rejects(
      () =>
        renderBatch(
          directory,
          plans,
          async () => assert.fail("Unexpected render"),
          async () => assert.fail("Unexpected verification"),
        ),
      /Refusing to overwrite an untracked output/,
    );
    assert.equal(sha256(file), fileHash);
    assert.equal(sha256(manifestPath), manifestHash);
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
