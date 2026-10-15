const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { splitTranscript } = require("./split-transcript.cjs");
const {
  frameAt,
  audioCoverage,
  speechBudget,
  buildPlans,
  stateAt,
} = require("./timing.cjs");
const { reserveBatch, renderBatch, sha256 } = require("./batch-output.cjs");
const { detectChineseFontFormat } = require("./font-format.cjs");
const {
  readVerificationReport,
  fileMatches,
  verifyMedia,
} = require("./render.cjs");
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
        // Shared templates live outside this package's dependency ancestry.
        module.paths.unshift(path.join(__dirname, "node_modules"));
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

const { Diagram, fontSourcesFor, RenderRoot } = loadClip();

test("media verification rejects a damaged packet despite intact stream metadata", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-decode-"));
  try {
    const file = path.join(directory, "probe.mp4");
    const encoded = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=size=32x32:rate=60",
        "-frames:v",
        "12",
        "-c:v",
        "libx264",
        "-bf",
        "0",
        file,
      ],
      { encoding: "utf8" },
    );
    assert.ifError(encoded.error);
    assert.equal(encoded.status, 0, encoded.stderr);
    const plan = { fps: 60, totalFrames: 12 };
    assert.equal(verifyMedia(plan, file).decoded, true);
    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_packets",
        "-show_entries",
        "packet=pos,size",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    );
    assert.ifError(probe.error);
    assert.equal(probe.status, 0, probe.stderr);
    const packet = JSON.parse(probe.stdout).packets[1];
    const bytes = fs.readFileSync(file);
    bytes.fill(0, Number(packet.pos), Number(packet.pos) + Number(packet.size));
    fs.writeFileSync(file, bytes);
    const metadata = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate,nb_frames,duration",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    );
    assert.ifError(metadata.error);
    assert.equal(metadata.status, 0, metadata.stderr);
    const stream = JSON.parse(metadata.stdout).streams[0];
    assert.equal(stream.avg_frame_rate, "60/1");
    assert.equal(Number(stream.nb_frames), plan.totalFrames);
    assert.equal(Number(stream.duration), plan.totalFrames / plan.fps);
    assert.throws(() => verifyMedia(plan, file));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("verification evidence is reused only for matching inputs and environment", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-evidence-"),
  );
  try {
    const file = path.join(directory, "report.json");
    const expected = {
      environment: { node: "v18.20.8", platform: "darwin", arch: "arm64" },
      implementationHashes: { "Clip.tsx": "clip-version" },
      fontHashes: { "chinese.ttf": "font-version" },
      transcriptSha256: "transcript-version",
    };
    const report = { ...expected, stills: [{ clip: "Batch-01", frame: 0 }] };
    fs.writeFileSync(file, JSON.stringify(report));
    assert.deepEqual(readVerificationReport(file, expected), report);
    for (const key of Object.keys(expected)) {
      assert.equal(
        readVerificationReport(file, { ...expected, [key]: "changed" }),
        null,
        key,
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

for (const program of ["ffmpeg", "ffprobe"]) {
  test(`a changed ${program} version invalidates media evidence`, () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "knowledge-tool-version-"),
    );
    try {
      const file = path.join(directory, "report.json");
      const environment = {
        node: process.version,
        externalMediaTools: { ffmpeg: "build A", ffprobe: "build A" },
      };
      fs.writeFileSync(file, JSON.stringify({ environment }));
      assert.ok(readVerificationReport(file, { environment }));
      assert.equal(
        readVerificationReport(file, {
          environment: {
            ...environment,
            externalMediaTools: {
              ...environment.externalMediaTools,
              [program]: "build B",
            },
          },
        }),
        null,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("missing or malformed verification reports rebuild while read errors remain visible", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-report-"));
  try {
    const file = path.join(directory, "report.json");
    assert.equal(readVerificationReport(file, { environment: {} }), null);
    fs.writeFileSync(file, "unfinished JSON");
    assert.equal(readVerificationReport(file, { environment: {} }), null);
    assert.throws(
      () => readVerificationReport(directory, { environment: {} }),
      { code: "EISDIR" },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("verification file reuse rejects missing and changed bytes and follows relocated paths", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-verified-file-"),
  );
  try {
    const oldFile = path.join(directory, "old.png");
    const file = path.join(directory, "moved.png");
    fs.writeFileSync(oldFile, "verified bytes");
    const digest = sha256(oldFile);
    fs.renameSync(oldFile, file);
    assert.equal(fileMatches(file, digest), true);
    assert.equal(fileMatches(oldFile, digest), false);
    assert.equal(fileMatches(file, undefined), false);
    fs.writeFileSync(file, "changed bytes");
    assert.equal(fileMatches(file, digest), false);
    assert.equal(fileMatches(directory, digest), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Chinese font headers select the actual TTF or TTC loader format", () => {
  for (const [signature, expected] of [
    [Buffer.from([0, 1, 0, 0]), "truetype"],
    [Buffer.from("true"), "truetype"],
    [Buffer.from("ttcf"), "collection"],
  ]) {
    const data = Buffer.concat([signature, Buffer.alloc(8)]);
    const format = detectChineseFontFormat(data);
    assert.equal(format, expected);
    const sources = fontSourcesFor(format);
    assert.equal(
      sources.find((source) => source.role === "chinese").format,
      expected,
    );
    assert.ok(
      sources
        .filter((source) => source.role !== "chinese")
        .every((source) => source.format === "woff2"),
    );
    const root = RenderRoot({
      plans: [{ id: "Probe", fps: 60, totalFrames: 1 }],
      audioTest: { startFrame: 0, totalFrames: 1 },
      chineseFontFormat: format,
    });
    const clip = root.props.children[0][0];
    assert.equal(clip.props.defaultProps.chineseFontFormat, expected);
  }
});

test("unsupported and truncated Chinese font inputs fail instead of claiming WOFF2", () => {
  for (const data of [
    Buffer.alloc(0),
    Buffer.from("ttcf"),
    Buffer.from([0xf4, 0xf4, 0xe3, 0xe6, ...Array(8).fill(0)]),
    ...["wOF2", "wOFF", "OTTO", "<htm"].map((signature) =>
      Buffer.concat([Buffer.from(signature), Buffer.alloc(8)]),
    ),
  ]) {
    assert.throws(
      () => detectChineseFontFormat(data),
      /TrueType font or TTC collection/,
    );
  }
});

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

test("Markdown hard breaks preserve word boundaries and spoken duration", async () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const marker of ["  ", "\\"]) {
      const source = `first${marker}${newline}second`;
      const { sections } = await splitTranscript(source);
      assert.equal(sections[0].raw, source);
      assert.deepEqual(sections[0].paragraphs, ["first second"]);
      assert.equal(speechBudget(sections[0].paragraphs[0]), 0.8);
    }
  }
});

test("soft wraps preserve English words and CJK cue matching", async () => {
  const source = fixture("transcript.md");
  const { sections } = await splitTranscript(source);
  const original = buildPlans(sections);
  const phrase = original[0].cues[1].phrase;
  for (const newline of ["\n", "\r\n"]) {
    const english = await splitTranscript(`first${newline}second`);
    assert.deepEqual(english.sections[0].paragraphs, ["first second"]);
    assert.equal(speechBudget(english.sections[0].paragraphs[0]), 0.8);
    const wrapped = source.replace(
      phrase,
      phrase.slice(0, -2) + newline + phrase.slice(-2),
    );
    const result = await splitTranscript(wrapped);
    const plans = buildPlans(result.sections);
    assert.deepEqual(
      plans.map((plan) => plan.cues),
      original.map((plan) => plan.cues),
    );
    assert.deepEqual(
      plans.map((plan) => plan.totalFrames),
      original.map((plan) => plan.totalFrames),
    );
  }
});

test("soft-break whitespace preserves cue matching and spoken duration", async () => {
  const source = fixture("transcript.md");
  const original = buildPlans((await splitTranscript(source)).sections);
  const phrase = original[0].cues[1].phrase;
  for (const newline of ["\n", "\r\n"]) {
    for (const [before, after] of [
      [" ", ""],
      ["\t", ""],
      ["", "  "],
      [" ", "\t "],
    ]) {
      const english = await splitTranscript(
        `first${before}${newline}${after}second`,
      );
      assert.deepEqual(english.sections[0].paragraphs, ["first second"]);
      assert.equal(speechBudget(english.sections[0].paragraphs[0]), 0.8);
      const wrapped = source.replace(
        phrase,
        phrase.replace("token ", `token${before}${newline}${after}`),
      );
      const result = await splitTranscript(wrapped);
      for (const section of result.sections)
        assert.equal(section.raw, wrapped.slice(section.start, section.end));
      const timing = (plans) =>
        plans.map(({ cues, totalFrames }) => ({ cues, totalFrames }));
      assert.deepEqual(timing(buildPlans(result.sections)), timing(original));
    }
  }
});

test("inline HTML tags do not contribute spoken words and br tags separate them", async () => {
  for (const [source, plain] of [
    ["This is <em>spoken</em>.", "This is spoken."],
    ["This is <!-- markup -->spoken.", "This is spoken."],
    ["foo<br>bar", "foo bar"],
    ["foo<BR />bar", "foo bar"],
    ["foo<br class='line'>bar", "foo bar"],
    ["**<em></em>**", ""],
  ]) {
    const { sections } = await splitTranscript(source);
    assert.equal(sections[0].raw, source);
    assert.deepEqual(sections[0].paragraphs, plain ? [plain] : []);
    assert.equal(
      speechBudget(sections[0].paragraphs[0] ?? ""),
      speechBudget(plain),
    );
  }
});

test("inline HTML around a cue preserves its duration and trigger", async () => {
  const source = fixture("transcript.md");
  const { sections } = await splitTranscript(source);
  const original = buildPlans(sections);
  const phrase = original[0].cues[1].phrase;
  for (const rendered of [
    phrase.replace("token", "<em>token</em>"),
    phrase.replace("token ", "token<br>"),
  ]) {
    const result = await splitTranscript(source.replace(phrase, rendered));
    const plans = buildPlans(result.sections);
    assert.deepEqual(
      plans.map((plan) => plan.cues),
      original.map((plan) => plan.cues),
    );
    assert.deepEqual(
      plans.map((plan) => plan.totalFrames),
      original.map((plan) => plan.totalFrames),
    );
  }
});

test("whitespace across inline nodes preserves cue matching and duration", async () => {
  const source = fixture("transcript.md");
  const original = buildPlans((await splitTranscript(source)).sections);
  const phrase = original[0].cues[1].phrase;
  for (const newline of ["\n", "\r\n"]) {
    for (const rendered of [
      `token <em>${newline}数量保持不变</em>`,
      `<em>token </em>${newline}数量保持不变`,
      `token <br>${newline}数量保持不变`,
      `token \\${newline} 数量保持不变`,
      "token \t <br />  数量保持不变",
      "token <em> \t </em> 数量保持不变",
    ]) {
      const wrapped = source.replace(phrase, rendered);
      const result = await splitTranscript(wrapped);
      for (const section of result.sections)
        assert.equal(section.raw, wrapped.slice(section.start, section.end));
      const timing = (plans) =>
        plans.map(({ cues, totalFrames }) => ({ cues, totalFrames }));
      assert.deepEqual(timing(buildPlans(result.sections)), timing(original));
    }
  }
});

test("only Markdown rules split clips while blank lines and empty markup add no speech", async () => {
  const source =
    " \n\n<br>\n\n\t \n\nfirst <br>\n  second\n\n**<br>**\n\n---\n\n<br />\n\n \t\n\n***\n\nthird\n\n";
  const { sections } = await splitTranscript(source);
  assert.equal(sections.length, 3);
  assert.deepEqual(
    sections.map((section) => section.paragraphs),
    [["first second"], [], ["third"]],
  );
  for (const section of sections)
    assert.equal(section.raw, source.slice(section.start, section.end));
});

test("standalone br lines preserve spoken sections, timing and source offsets", async () => {
  const source = fixture("transcript.md");
  const original = buildPlans((await splitTranscript(source)).sections);
  const speech = original[0].spokenText;
  for (const newline of ["\n", "\r\n"]) {
    for (const tag of ["<br>", "<BR />", "<br class='line'>"]) {
      const changed = source
        .replace(speech, `${tag}\n${tag}\n${speech}`)
        .replaceAll("\n", newline);
      const { sections } = await splitTranscript(changed);
      const plans = buildPlans(sections);
      assert.deepEqual(
        plans.map(({ spokenText, cues, totalFrames }) => ({
          spokenText,
          cues,
          totalFrames,
        })),
        original.map(({ spokenText, cues, totalFrames }) => ({
          spokenText,
          cues,
          totalFrames,
        })),
      );
      for (const section of sections)
        assert.equal(section.raw, changed.slice(section.start, section.end));
    }
  }
});

test("leading and internal br lines together preserve paragraph boundaries and narration cues", async () => {
  const source = fixture("transcript.md");
  const originalSections = (await splitTranscript(source)).sections;
  const originalPlans = buildPlans(originalSections);
  const speech = originalPlans[0].spokenText;
  const phrase = originalPlans[0].cues[1].phrase;
  const summary = (plans) =>
    plans.map(({ title, spokenText, cues, totalFrames }) => ({
      title,
      spokenText,
      cues,
      totalFrames,
    }));
  for (const newline of ["\n", "\r\n"]) {
    for (const tag of ["<br>", "<BR />", "<br class='line'>"]) {
      for (const container of ["", "> ", "- "]) {
        const wrapped = speech.replace(
          phrase,
          phrase.replace("token ", `token\n${tag}\n`),
        );
        const body = `${tag}\n${tag}\n${wrapped}`
          .split("\n")
          .map((line, index) => {
            const prefix = container === "- " && index > 0 ? "  " : container;
            return prefix + line;
          })
          .join("\n");
        const changed = source.replace(speech, body).replaceAll("\n", newline);
        const { sections } = await splitTranscript(changed);
        assert.deepEqual(
          sections.map((section) => section.paragraphs),
          originalSections.map((section) => section.paragraphs),
        );
        assert.deepEqual(summary(buildPlans(sections)), summary(originalPlans));
        for (const section of sections)
          assert.equal(section.raw, changed.slice(section.start, section.end));
      }
    }
  }
});

test("outer and list-internal br blocks together preserve narration and source offsets", async () => {
  const source = fixture("transcript.md");
  const originalSections = (await splitTranscript(source)).sections;
  const originalPlans = buildPlans(originalSections);
  const speech = originalPlans[0].spokenText;
  const summary = (plans) =>
    plans.map(({ title, spokenText, cues, totalFrames }) => ({
      title,
      spokenText,
      cues,
      totalFrames,
    }));
  for (const newline of ["\n", "\r\n"]) {
    for (const tag of ["<br>", "<BR />", "<br class='line'>"]) {
      for (const list of [
        `- ${tag}\n  ${speech}`,
        `1. ${tag}\n   ${speech}`,
        `- ${tag}\n  - ${tag}\n    ${speech}`,
        `> - ${tag}\n>   ${speech}`,
      ]) {
        const changed = source
          .replace(speech, `${tag}\n${list}`)
          .replaceAll("\n", newline);
        const { sections } = await splitTranscript(changed);
        assert.deepEqual(
          sections.map((section) => section.paragraphs),
          originalSections.map((section) => section.paragraphs),
        );
        assert.deepEqual(summary(buildPlans(sections)), summary(originalPlans));
        for (const section of sections)
          assert.equal(section.raw, changed.slice(section.start, section.end));
      }
    }
  }
});

test("br cleanup preserves nested speech and keeps actual HTML and code unspoken", async () => {
  for (const container of ["", "> ", "- "]) {
    const continuation = container === "- " ? "  " : container;
    const source = `${container}<br>\n${continuation}**<br>**\n${continuation}First spoken paragraph.\n\n<div>\n<br>\nHidden HTML sentence.\n</div>\n\n~~~text\n<br>\nHidden code sentence.\n---\n~~~\n\n---\n\nSecond spoken paragraph.\n`;
    const { sections } = await splitTranscript(source);
    assert.equal(sections.length, 2);
    assert.deepEqual(
      sections.map((section) => section.paragraphs),
      [["First spoken paragraph."], ["Second spoken paragraph."]],
    );
    for (const section of sections)
      assert.equal(section.raw, source.slice(section.start, section.end));
  }
});

for (const changedTool of ["ffmpeg", "ffprobe"]) {
  test(`a changed ${changedTool} cannot reuse completed-clip decode claims`, async () => {
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "knowledge-decode-resume-"),
    );
    try {
      const skill = path.join(parent, "skill");
      fs.cpSync(path.resolve(__dirname, "../.."), skill, {
        recursive: true,
        filter: (file) => path.basename(file) !== "node_modules",
      });
      const renderer = path.join(skill, "evals/regression/render.cjs");
      const tests = path.join(skill, "evals/regression/regression.test.cjs");
      const fonts = path.join(parent, "fonts");
      const outputs = path.join(parent, "outputs");
      fs.mkdirSync(fonts);
      for (const file of ["title.woff2", "body.woff2", "mono.woff2"])
        fs.writeFileSync(path.join(fonts, file), "test font bytes");
      fs.writeFileSync(
        path.join(fonts, "chinese.ttf"),
        Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      );
      const preload = path.join(parent, "decoder.cjs");
      fs.writeFileSync(
        preload,
        `
        const fs = require("node:fs");
        const path = require("node:path");
        const Module = require("node:module");
        const load = Module._load;
        Module._load = function(name, ...args) {
          const exports = load.call(this, name, ...args);
          return name === "@remotion/bundler"
            ? {...exports, bundle: () => {
                if (process.env.KNOWLEDGE_RENDER_MARKER) fs.writeFileSync(process.env.KNOWLEDGE_RENDER_MARKER, "called");
                throw new Error("Unexpected media rendering");
              }}
            : exports;
        };
        const rename = fs.renameSync;
        fs.renameSync = (source, target) => {
          if (process.env.KNOWLEDGE_FAIL_PUBLICATION && path.basename(target) === "report.json")
            throw new Error("Report publication failed");
          return rename(source, target);
        };
        require("node:child_process").spawnSync = (program, args) => {
          if (process.env.KNOWLEDGE_PREPARE_SNAPSHOT) throw new Error("Snapshot prepared");
          if (program === process.execPath) return {status: 0, stdout: args[0] === "--test" ? "# tests 2\\n# pass 2\\n# fail 0\\n" : "Current type check passed\\n"};
          if (args[0] === "-version") return {status: 0, stdout: !process.env.KNOWLEDGE_PREVIOUS_TOOLS && program === ${JSON.stringify(changedTool)} ? "version B" : "version A"};
          if (program === "ffprobe") {
            const file = args[args.length - 1];
            const plans = JSON.parse(fs.readFileSync(path.join(path.dirname(file), "plans.json"))).plans;
            const plan = plans.find((plan) => file.endsWith(plan.id + ".mp4"));
            return {status: 0, stdout: JSON.stringify({streams: [{avg_frame_rate: plan.fps + "/1", nb_frames: String(plan.totalFrames), duration: String(plan.totalFrames / plan.fps)}]})};
          }
          return {status: 71, stderr: "Current decoder rejected completed clip"};
        };
      `,
      );
      const run = (args, flags = {}) =>
        spawnSync(
          process.execPath,
          ["--require", preload, renderer, ...args, fonts],
          {
            encoding: "utf8",
            timeout: 10000,
            env: {
              ...process.env,
              NODE_PATH:
                path.dirname(
                  require.resolve("@remotion/bundler/package.json"),
                ) + "/../..",
              ...flags,
            },
          },
        );
      const prepared = run([outputs], { KNOWLEDGE_PREPARE_SNAPSHOT: "1" });
      assert.match(prepared.stderr, /Snapshot prepared/);
      const directory = path.join(outputs, fs.readdirSync(outputs)[0]);
      const inputs = JSON.parse(
        fs.readFileSync(path.join(directory, "plans.json"), "utf8"),
      );
      await renderBatch(
        directory,
        inputs.plans,
        (plan, file) => fs.writeFileSync(file, plan.id),
        async () => ({ decoded: true }),
      );
      const reportFile = path.join(directory, "report.json");
      const testEvidence = path.join(directory, "tests.tap");
      const typeCheckEvidence = path.join(directory, "typecheck.log");
      fs.writeFileSync(testEvidence, "# tests 1\n# pass 1\n# fail 0\n");
      fs.writeFileSync(typeCheckEvidence, "Previous type check passed\n");
      const stills = inputs.plans.flatMap((plan) => {
        const frames = new Set([
          0,
          Math.round(plan.totalFrames / 2),
          ...plan.cues.flatMap((cue) => [
            Math.max(0, cue.startFrame - 1),
            cue.startFrame + plan.transitionFrames,
          ]),
          plan.totalFrames - plan.holdFrames,
          plan.totalFrames - 1,
        ]);
        return [...frames].map((frame) => {
          const file = path.join(directory, `${plan.id}-${frame}.png`);
          fs.writeFileSync(file, "cached still");
          return { clip: plan.id, frame, sha256: sha256(file) };
        });
      });
      const audioDirectory = path.join(directory, "audio-coverage");
      fs.mkdirSync(audioDirectory);
      const audioHashes = Object.fromEntries(
        [
          "mixed.wav",
          "silent.mp4",
          "audio-coverage-test.mp4",
          "decoded-audio.f32",
        ].map((name) => {
          const file = path.join(audioDirectory, name);
          fs.writeFileSync(file, "cached audio");
          return [name, sha256(file)];
        }),
      );
      const previousReport = JSON.stringify({
        environment: {
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          dependencies: inputs.dependencies,
          externalMediaTools: { ffmpeg: "version A", ffprobe: "version A" },
        },
        implementationHashes: inputs.implementationHashes,
        fontHashes: inputs.fontHashes,
        transcriptSha256: sha256(
          path.join(__dirname, "../fixtures/batch-transcript/transcript.md"),
        ),
        unitTests: { sourceSha256: sha256(tests), evidence: testEvidence },
        typeCheck: { passed: true, evidence: typeCheckEvidence },
        stills,
        audioTail: {
          sourceSha256: inputs.audioSourceSha256,
          decodedFractionalTailPeak: 0.5,
          fileHashes: audioHashes,
        },
      });
      fs.writeFileSync(reportFile, previousReport);
      fs.appendFileSync(tests, "\n// Updated regression coverage.\n");
      assert.notEqual(
        sha256(tests),
        JSON.parse(previousReport).unitTests.sourceSha256,
      );
      const files = inputs.plans.map((plan) =>
        path.join(directory, `${plan.id}.mp4`),
      );
      files.push(testEvidence, typeCheckEvidence);
      const snapshot = (paths = files) =>
        paths.map((file) => ({
          sha256: sha256(file),
          mtime: fs.statSync(file).mtimeMs,
        }));
      const before = snapshot();
      const resumed = run(["--resume", directory]);
      assert.equal(resumed.status, 1, resumed.stderr);
      assert.match(resumed.stderr, /Current decoder rejected completed clip/);
      assert.doesNotMatch(resumed.stderr, /Unexpected media rendering/);
      assert.equal(fs.readFileSync(reportFile, "utf8"), previousReport);
      assert.deepEqual(snapshot(), before);
      const partialDirectory = path.join(parent, "partial-batch");
      fs.cpSync(directory, partialDirectory, { recursive: true });
      const manifestFile = path.join(partialDirectory, "manifest.json");
      const partialManifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      const failedPlan = inputs.plans[0];
      partialManifest.clips[failedPlan.id] = {
        status: "failed",
        error: "Earlier render failed",
      };
      fs.rmSync(path.join(partialDirectory, `${failedPlan.id}.mp4`));
      fs.writeFileSync(manifestFile, JSON.stringify(partialManifest));
      const partialNames = fs.readdirSync(partialDirectory);
      const partialFiles = partialNames
        .map((name) => path.join(partialDirectory, name))
        .filter((file) => fs.statSync(file).isFile());
      const partialBefore = snapshot(partialFiles);
      const renderMarker = path.join(parent, "render-called");
      const partialResume = run(["--resume", partialDirectory], {
        KNOWLEDGE_RENDER_MARKER: renderMarker,
      });
      assert.equal(partialResume.status, 1, partialResume.stderr);
      assert.equal(
        fs.existsSync(renderMarker),
        false,
        "Render ran before completed-clip preflight",
      );
      assert.match(
        partialResume.stderr,
        /Current decoder rejected completed clip/,
      );
      assert.deepEqual(snapshot(partialFiles), partialBefore);
      assert.deepEqual(
        fs.readdirSync(partialDirectory).sort(),
        partialNames.sort(),
      );
      assert.deepEqual(snapshot(), before);
      const publicationFailure = run(["--resume", directory], {
        KNOWLEDGE_PREVIOUS_TOOLS: "1",
        KNOWLEDGE_FAIL_PUBLICATION: "1",
      });
      assert.equal(publicationFailure.status, 1, publicationFailure.stderr);
      assert.match(publicationFailure.stderr, /Report publication failed/);
      assert.equal(fs.readFileSync(reportFile, "utf8"), previousReport);
      assert.deepEqual(snapshot(), before);
      const successful = run(["--resume", directory], {
        KNOWLEDGE_PREVIOUS_TOOLS: "1",
      });
      assert.equal(successful.status, 0, successful.stderr);
      assert.deepEqual(snapshot(), before);
      const current = JSON.parse(fs.readFileSync(reportFile, "utf8"));
      assert.equal(current.unitTests.sourceSha256, sha256(tests));
      assert.equal(current.unitTests.passed, 2);
      assert.notEqual(current.unitTests.evidence, testEvidence);
      assert.notEqual(current.typeCheck.evidence, typeCheckEvidence);
      assert.equal(
        fs.readFileSync(current.unitTests.evidence, "utf8"),
        "# tests 2\n# pass 2\n# fail 0\n",
      );
      assert.equal(
        fs.readFileSync(current.typeCheck.evidence, "utf8"),
        "Current type check passed\n",
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
}

test("a hard break inside a cue preserves its plan and duration", async () => {
  const source = fixture("transcript.md");
  const { sections } = await splitTranscript(source);
  const original = buildPlans(sections);
  const phrase = original[0].cues[1].phrase;
  for (const marker of ["  ", "\\"]) {
    const broken = source.replace(
      phrase,
      phrase.replace("token ", `token${marker}\n`),
    );
    const result = await splitTranscript(broken);
    const plans = buildPlans(result.sections);
    assert.deepEqual(
      plans.map((plan) => plan.cues),
      original.map((plan) => plan.cues),
    );
    assert.deepEqual(
      plans.map((plan) => plan.totalFrames),
      original.map((plan) => plan.totalFrames),
    );
  }
});

for (const invalid of ["missing", "changed"]) {
  test(`the renderer refuses a ${invalid} resume snapshot before changing files`, () => {
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "knowledge-cli-resume-"),
    );
    try {
      const fonts = path.join(parent, "fonts");
      const directory = path.join(parent, "batch");
      fs.mkdirSync(fonts);
      fs.mkdirSync(directory);
      for (const file of ["title.woff2", "body.woff2", "mono.woff2"])
        fs.writeFileSync(path.join(fonts, file), "test font bytes");
      fs.writeFileSync(
        path.join(fonts, "chinese.ttf"),
        Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      );
      if (invalid === "changed") {
        fs.writeFileSync(
          path.join(directory, "plans.json"),
          JSON.stringify({ plans: [] }),
        );
        fs.writeFileSync(
          path.join(directory, "manifest.json"),
          JSON.stringify({ clips: {} }),
        );
      }
      const snapshot = () =>
        Object.fromEntries(
          fs
            .readdirSync(directory)
            .map((file) => [file, sha256(path.join(directory, file))]),
        );
      const before = snapshot();
      const child = spawnSync(
        process.execPath,
        [require.resolve("./render.cjs"), "--resume", directory, fonts],
        { encoding: "utf8", timeout: 10000 },
      );
      assert.equal(child.status, 1, child.stderr);
      assert.match(
        child.stderr,
        invalid === "missing" ? /existing batch/ : /Resume inputs changed/,
      );
      assert.deepEqual(snapshot(), before);
      assert.deepEqual(fs.readdirSync(parent).sort(), ["batch", "fonts"]);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
}

for (const invalid of ["missing", "changed"]) {
  test(`the renderer rejects a ${invalid} tail signal before resuming media verification`, () => {
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "knowledge-tail-snapshot-"),
    );
    try {
      const fonts = path.join(parent, "fonts");
      const outputs = path.join(parent, "outputs");
      fs.mkdirSync(fonts);
      for (const file of ["title.woff2", "body.woff2", "mono.woff2"])
        fs.writeFileSync(path.join(fonts, file), "test font bytes");
      fs.writeFileSync(
        path.join(fonts, "chinese.ttf"),
        Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      );
      const preload = path.join(parent, "stop-after-snapshot.cjs");
      fs.writeFileSync(
        preload,
        'require("node:child_process").spawnSync = () => { throw new Error("Reached test execution"); };',
      );
      const run = (args) =>
        spawnSync(
          process.execPath,
          [
            "--require",
            preload,
            require.resolve("./render.cjs"),
            ...args,
            fonts,
          ],
          { encoding: "utf8", timeout: 10000 },
        );
      const created = run([outputs]);
      assert.equal(created.status, 1, created.stderr);
      assert.match(created.stderr, /Reached test execution/);
      const directory = path.join(outputs, fs.readdirSync(outputs)[0]);
      const source = path.join(directory, "public", "tail-signal.wav");
      const inputs = JSON.parse(
        fs.readFileSync(path.join(directory, "plans.json"), "utf8"),
      );
      assert.equal(inputs.audioSourceSha256, sha256(source));
      fs.writeFileSync(
        path.join(directory, "manifest.json"),
        JSON.stringify({ clips: {} }),
      );
      if (invalid === "missing") fs.unlinkSync(source);
      else {
        const wav = fs.readFileSync(source);
        wav.writeInt16LE(20000, 44);
        fs.writeFileSync(source, wav);
      }
      const snapshot = () => {
        const files = [
          ...fs.readdirSync(directory).filter((file) => file !== "public"),
          ...fs
            .readdirSync(path.join(directory, "public"))
            .map((file) => path.join("public", file)),
        ];
        return Object.fromEntries(
          files.map((file) => [file, sha256(path.join(directory, file))]),
        );
      };
      const before = snapshot();
      const resumed = run(["--resume", directory]);
      assert.equal(resumed.status, 1, resumed.stderr);
      assert.match(
        resumed.stderr,
        invalid === "missing"
          ? /ENOENT.*tail-signal.wav/
          : /Batch tail signal changed/,
      );
      assert.doesNotMatch(resumed.stderr, /Reached test execution/);
      assert.deepEqual(snapshot(), before);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
}

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

for (const name of ["leading-rule.md", "leading-mapping.md", "transcript.md"]) {
  test(`leading blanks and br blocks preserve metadata and narration in ${name}`, async () => {
    const spokenSections = (sections) =>
      sections
        .filter((section) => section.paragraphs.length > 0)
        .map(({ title, paragraphs }) => ({ title, paragraphs }));
    for (const newline of ["\n", "\r\n"]) {
      const original = fixture(name).replaceAll("\n", newline);
      const expected = await splitTranscript(original);
      for (const whitespace of ["", "\n", " \n\t\n", "\uFEFF\n\n"]) {
        for (const tag of ["", "<br>", "<BR />", "<br class='line'>"]) {
          const prefix = (
            whitespace + (tag ? `${tag}\n${tag}\n\n` : "")
          ).replaceAll("\n", newline);
          for (const suffix of ["", " ", "\t"]) {
            const source = prefix + original.replace(/^---/, `---${suffix}`);
            const { metadataEnd, sections } = await splitTranscript(source);
            assert.equal(
              metadataEnd,
              expected.metadataEnd
                ? prefix.length + suffix.length + expected.metadataEnd
                : 0,
            );
            assert.deepEqual(
              spokenSections(sections),
              spokenSections(expected.sections),
            );
            for (const section of sections)
              assert.equal(
                section.raw,
                source.slice(section.start, section.end),
              );
            if (name === "transcript.md") {
              assert.deepEqual(
                buildPlans(sections).map(
                  ({ spokenText, cues, totalFrames }) => ({
                    spokenText,
                    cues,
                    totalFrames,
                  }),
                ),
                buildPlans(expected.sections).map(
                  ({ spokenText, cues, totalFrames }) => ({
                    spokenText,
                    cues,
                    totalFrames,
                  }),
                ),
              );
            }
          }
        }
      }
    }
  });
}

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
        state(cue.startFrame + plan.transitionFrames, plan).actions[index],
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

for (const rate of [4.5, 5.2, 6]) {
  for (const includesPauses of [false, true]) {
    test(`actions settle before the shared ending hold at rate ${rate}, pauses included: ${includesPauses}`, async () => {
      const { sections } = await splitTranscript(fixture("transcript.md"));
      const plans = buildPlans(sections, { rate, includesPauses });
      verifyProgress(plans, stateAt);
      for (const plan of plans) {
        assert.equal(plan.totalFrames, frameAt(plan.estimatedSeconds));
        assert.ok(plan.holdFrames >= 1);
        const holdStart = plan.totalFrames - plan.holdFrames;
        const position = (frame) =>
          gridModule.getGridTravelSeconds(
            frame / plan.fps,
            plan.totalFrames / plan.fps,
            plan.holdFrames / plan.fps,
          );
        for (let frame = holdStart; frame < plan.totalFrames; frame++) {
          assert.equal(position(frame), position(holdStart));
        }
      }
    });
  }
}

test("invalid speech rates fail before producing a plan", async () => {
  const { sections } = await splitTranscript(fixture("transcript.md"));
  for (const rate of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(
      () => buildPlans(sections, { rate }),
      /finite positive number/,
    );
  }
});

test("a short speech budget shortens the transition instead of extending the clip", async () => {
  const { sections } = await splitTranscript(fixture("transcript.md"));
  const plans = buildPlans(sections, { rate: 50, includesPauses: true });
  verifyProgress(plans, stateAt);
  assert.ok(plans.some((plan) => plan.transitionFrames < frameAt(0.8)));
  for (const plan of plans)
    assert.equal(plan.totalFrames, frameAt(plan.estimatedSeconds));
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

test("landscape diagrams reserve complete label lines above default and enlarged caption areas", () => {
  const {
    getCanvasScale,
    getContentBottomInset,
    resolveVideoStyle,
  } = require("../../assets/template/video-style.ts");
  const nodes = (element) => {
    if (!React.isValidElement(element)) return [];
    return [
      element,
      ...React.Children.toArray(element.props.children).flatMap(nodes),
    ];
  };
  for (const [width, height] of [
    [640, 360],
    [1920, 1080],
    [2560, 1440],
  ]) {
    for (const ratio of [0.18, 0.28]) {
      const theme = resolveVideoStyle({
        layout: { captionSafeAreaRatio: ratio },
      });
      const scale = getCanvasScale(width, height, theme);
      const contentBottom =
        (height - getContentBottomInset(width, height, theme)) / scale;
      for (const [kind, groups] of Object.entries(resultLabels)) {
        const rendered = nodes(
          Diagram({ kind, actions: [1, 1, 1], contentBottom }),
        );
        const labels = rendered.filter((node) => node.type === "text");
        const conclusion = labels.find(
          (node) => node.props.children === groups.at(-1)[0],
        );
        assert.ok(conclusion, kind);
        for (const { props } of labels) {
          // Reserve a full ascent and half an em of descent without clipping.
          assert.ok(props.y - props.fontSize >= 260, props.children);
          assert.ok(
            props.y + props.fontSize / 2 <= contentBottom,
            props.children,
          );
          assert.equal(props.fontSize, 42);
          if (props !== conclusion.props) {
            assert.ok(
              props.y + props.fontSize / 2 <
                conclusion.props.y - conclusion.props.fontSize,
              `${kind}: conclusion overlaps ${props.children}`,
            );
          }
        }
        for (const { props } of rendered.filter(
          (node) => node.type === "rect",
        )) {
          assert.ok(props.height > 0);
          assert.ok(
            props.y + props.height + (props.strokeWidth ?? 0) / 2 <
              conclusion.props.y - conclusion.props.fontSize,
          );
        }
        assert.equal(conclusion.props.x, 960);
        assert.ok(conclusion.props.y * scale < height * (1 - ratio));
      }
    }
  }
});

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

test("a moved completed batch refreshes paths without re-encoding", async () => {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-moved-complete-"),
  );
  const plans = [{ id: "Test-1" }];
  try {
    const original = reserveBatch(parent, "sample");
    await renderBatch(
      original,
      plans,
      async (plan, file) => fs.writeFileSync(file, plan.id),
      async () => ({ decoded: true }),
    );
    const digest = sha256(path.join(original, "Test-1.mp4"));
    const moved = path.join(parent, "moved");
    fs.renameSync(original, moved);
    const manifest = await renderBatch(
      moved,
      plans,
      async () => assert.fail("Unexpected render"),
      async () => assert.fail("Unexpected verification"),
    );
    assert.equal(manifest.clips["Test-1"].file, path.join(moved, "Test-1.mp4"));
    assert.equal(sha256(manifest.clips["Test-1"].file), digest);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(moved, "manifest.json"), "utf8")),
      manifest,
    );
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

for (const phase of ["before-publish", "after-publish"]) {
  test(`a moved ${phase} checkpoint refreshes all output paths`, async () => {
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "knowledge-moved-ready-"),
    );
    const plans = [1, 2, 3].map((order) => ({ id: `Test-${order}` }));
    try {
      const original = reserveBatch(parent, "sample");
      interruptPublication(original, plans, phase);
      const digest = sha256(
        path.join(
          original,
          phase === "before-publish" ? "Test-2.pending.mp4" : "Test-2.mp4",
        ),
      );
      const moved = path.join(parent, "moved");
      fs.renameSync(original, moved);
      const rendered = [];
      const manifest = await renderBatch(
        moved,
        plans,
        async (plan, file) => {
          rendered.push(plan.id);
          fs.writeFileSync(file, plan.id);
        },
        async () => ({ decoded: true }),
      );
      assert.deepEqual(rendered, ["Test-3"]);
      for (const plan of plans) {
        assert.equal(
          manifest.clips[plan.id].file,
          path.join(moved, `${plan.id}.mp4`),
        );
        assert.ok(fs.existsSync(manifest.clips[plan.id].file));
      }
      assert.equal(sha256(manifest.clips["Test-2"].file), digest);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
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
