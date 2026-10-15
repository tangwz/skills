const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { bundle } = require("@remotion/bundler");
const {
  selectComposition,
  renderMedia,
  renderStill,
} = require("@remotion/renderer");
const { splitTranscript } = require("./split-transcript.cjs");
const { audioCoverage, buildPlans, stateAt } = require("./timing.cjs");
const { reserveBatch, renderBatch, sha256 } = require("./batch-output.cjs");
const { detectChineseFontFormat } = require("./font-format.cjs");

function readVerificationReport(file, expected) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
  return Object.entries(expected).every(([key, value]) =>
    isDeepStrictEqual(report?.[key], value),
  )
    ? report
    : null;
}

function fileMatches(file, digest) {
  if (!digest) return false;
  try {
    return sha256(file) === digest;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") return false;
    throw error;
  }
}

function command(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr);
  }
  return result.stdout;
}

function verifyMedia(plan, file) {
  const metadata = JSON.parse(
    command("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=avg_frame_rate,nb_frames,duration",
      "-of",
      "json",
      file,
    ]),
  ).streams[0];
  const [numerator, denominator] = metadata.avg_frame_rate
    .split("/")
    .map(Number);
  assert.equal(numerator / denominator, plan.fps);
  assert.equal(Number(metadata.nb_frames), plan.totalFrames);
  assert.ok(
    Math.abs(Number(metadata.duration) - plan.totalFrames / plan.fps) <
      1 / plan.fps,
  );
  command("ffmpeg", ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"]);
  return {
    fps: numerator / denominator,
    frames: Number(metadata.nb_frames),
    seconds: Number(metadata.duration),
    decoded: true,
  };
}

function writeTailSignal(file) {
  const sampleRate = 48000;
  const samples = Math.round(1.004 * sampleRate);
  const data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples * 2, 40);
  // A signal only in the fractional tail makes truncation observable after decoding.
  for (let sample = sampleRate; sample < samples; sample++) {
    data.writeInt16LE(
      Math.round(20000 * Math.sin((2 * Math.PI * 1000 * sample) / sampleRate)),
      44 + sample * 2,
    );
  }
  fs.writeFileSync(file, data);
}

async function main() {
  const resume = process.argv[2] === "--resume";
  const outputTarget = process.argv[resume ? 3 : 2];
  const fontDirectory = process.argv[resume ? 4 : 3];
  if (
    !outputTarget ||
    !fontDirectory ||
    process.argv.length !== (resume ? 5 : 4)
  )
    throw new Error(
      "Usage: node render.cjs [--resume] OUTPUT_TARGET FONT_DIRECTORY",
    );
  const requiredDependencies = require("./package.json").dependencies;
  const dependencies = Object.fromEntries(
    Object.keys(requiredDependencies).map((name) => [
      name,
      require(`${name}/package.json`).version,
    ]),
  );
  for (const [name, version] of Object.entries(requiredDependencies)) {
    assert.equal(
      dependencies[name],
      version,
      `Dependency version mismatch: ${name}`,
    );
  }
  const dependencyRoot = path.resolve(
    path.dirname(require.resolve("remotion/package.json")),
    "../..",
  );
  for (const name of Object.keys({
    ...requiredDependencies,
    ...require("./package.json").devDependencies,
  })) {
    assert.equal(
      require.resolve(`${name}/package.json`),
      path.join(dependencyRoot, "node_modules", name, "package.json"),
      `Dependencies must resolve from one npm installation: ${name}`,
    );
  }
  const installedPackages = JSON.parse(
    command("npm", [
      "query",
      "*",
      "--package-lock-only=false",
      "--prefix",
      dependencyRoot,
    ]),
  )
    .filter((entry) => entry.location)
    .map(({ location, name, version }) => [location, name, version])
    .sort();
  const dependencyTreeSha256 = createHash("sha256")
    .update(JSON.stringify(installedPackages))
    .digest("hex");
  const chineseFontData = fs.readFileSync(
    path.join(fontDirectory, "chinese.ttf"),
  );
  const chineseFontFormat = detectChineseFontFormat(chineseFontData);
  const fontHashes = Object.fromEntries(
    ["title.woff2", "body.woff2", "chinese.ttf", "mono.woff2"].map((file) => [
      file,
      sha256(path.join(fontDirectory, file)),
    ]),
  );
  const implementationHashes = Object.fromEntries(
    [
      "Clip.tsx",
      "render.cjs",
      "timing.cjs",
      "batch-output.cjs",
      "split-transcript.cjs",
      "font-format.cjs",
      "package-lock.json",
      "tsconfig.json",
      "../../assets/template/VideoChrome.tsx",
      "../../assets/template/video-style.ts",
      "../../assets/template/video-brand.ts",
      "../../assets/template/grid-motion.ts",
      "../../assets/template/end-card-timing.ts",
    ].map((file) => [file, sha256(path.join(__dirname, file))]),
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../fixtures/batch-transcript/transcript.md"),
    "utf8",
  );
  const { sections } = await splitTranscript(source);
  const plans = buildPlans(sections);
  const audioTest = audioCoverage(0.004, 1.004);
  const inputs = {
    plans,
    audioTest,
    chineseFontFormat,
    fontHashes,
    implementationHashes,
    dependencies,
    dependencyTreeSha256,
  };
  const directory = resume
    ? path.resolve(outputTarget)
    : reserveBatch(path.resolve(outputTarget), "batch-regression");
  const plansFile = path.join(directory, "plans.json");
  const publicDir = path.join(directory, "public");
  const tailSignalFile = path.join(publicDir, "tail-signal.wav");
  if (resume) {
    if (
      !fs.existsSync(plansFile) ||
      !fs.existsSync(path.join(directory, "manifest.json"))
    )
      throw new Error(
        "Resume requires an existing batch with input snapshot and manifest",
      );
    const { audioSourceSha256, ...originalInputs } = JSON.parse(
      fs.readFileSync(plansFile, "utf8"),
    );
    assert.deepEqual(
      originalInputs,
      inputs,
      "Resume inputs changed or are unverifiable; reserve a new batch",
    );
    assert.equal(
      sha256(tailSignalFile),
      audioSourceSha256,
      "Batch tail signal changed",
    );
    for (const [file, digest] of Object.entries(fontHashes))
      assert.equal(
        sha256(path.join(publicDir, file)),
        digest,
        "Batch font changed",
      );
  } else {
    fs.mkdirSync(publicDir);
    for (const file of Object.keys(fontHashes)) {
      fs.copyFileSync(
        path.join(fontDirectory, file),
        path.join(publicDir, file),
      );
    }
    writeTailSignal(tailSignalFile);
    fs.writeFileSync(
      plansFile,
      JSON.stringify(
        {
          ...inputs,
          audioSourceSha256: sha256(tailSignalFile),
        },
        null,
        2,
      ),
    );
  }
  const testFile = path.join(__dirname, "regression.test.cjs");
  const testSourceSha256 = sha256(testFile);
  const unitOutput = command(process.execPath, [
    "--test",
    "--test-reporter=tap",
    testFile,
  ]);
  const typeCheckOutput = command(process.execPath, [
    require.resolve("typescript/bin/tsc"),
    "-p",
    path.join(__dirname, "tsconfig.json"),
  ]);
  const environment = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    dependencies,
    dependencyTreeSha256,
    externalMediaTools: Object.fromEntries(
      ["ffmpeg", "ffprobe"].map((program) => [
        program,
        command(program, ["-version"]).trim(),
      ]),
    ),
  };
  const transcriptSha256 = sha256(
    path.join(__dirname, "../fixtures/batch-transcript/transcript.md"),
  );
  const cachedReport = resume
    ? readVerificationReport(path.join(directory, "report.json"), {
        environment,
        implementationHashes,
        fontHashes,
        transcriptSha256,
      })
    : null;
  const previousManifest = resume
    ? JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"))
    : null;
  const revalidatedMedia = new Map();
  if (previousManifest && !cachedReport) {
    for (const plan of plans) {
      const clip = previousManifest.clips[plan.id];
      if (clip?.status !== "complete" && clip?.status !== "ready") continue;
      const file = path.join(directory, `${plan.id}.mp4`);
      const candidate =
        clip.status === "ready" && !fs.existsSync(file)
          ? path.join(directory, `${plan.id}.pending.mp4`)
          : file;
      revalidatedMedia.set(plan.id, verifyMedia(plan, candidate));
    }
  }
  const entry = path.join(directory, "entry.tsx");
  fs.writeFileSync(
    entry,
    [
      'import React from "react";',
      'import {registerRoot} from "remotion";',
      `import {RenderRoot} from ${JSON.stringify(path.join(__dirname, "Clip.tsx"))};`,
      'import data from "./plans.json";',
      "registerRoot(() => <RenderRoot {...data} />);",
    ].join("\n"),
  );
  let serveUrl;
  const compositions = new Map();
  const getComposition = async (id) => {
    if (!serveUrl) serveUrl = await bundle({ entryPoint: entry, publicDir });
    if (!compositions.has(id))
      compositions.set(id, await selectComposition({ serveUrl, id }));
    return compositions.get(id);
  };
  const render = async (plan, outputLocation) => {
    const composition = await getComposition(plan.id);
    assert.equal(composition.durationInFrames, plan.totalFrames);
    return renderMedia({
      serveUrl,
      composition,
      outputLocation,
      codec: "h264",
      concurrency: 2,
      logLevel: "error",
    });
  };
  // Exercise recovery with real encoded siblings, not only mocked file writes.
  let injectFailure = !resume;
  const calls = [];
  const injectedRender = async (plan, output) => {
    calls.push(plan.id);
    if (injectFailure && plan.order === 2)
      throw new Error("Injected second-clip failure");
    await render(plan, output);
  };
  const first =
    previousManifest ??
    (await renderBatch(directory, plans, injectedRender, verifyMedia));
  if (!resume) assert.equal(first.clips[plans[1].id].status, "failed");
  const completed = plans.filter(
    (plan) => first.clips[plan.id]?.status === "complete",
  );
  const preserved = completed.map((plan) =>
    sha256(path.join(directory, `${plan.id}.mp4`)),
  );
  injectFailure = false;
  calls.length = 0;
  const manifest = await renderBatch(
    directory,
    plans,
    injectedRender,
    verifyMedia,
  );
  if (!resume) assert.deepEqual(calls, [plans[1].id]);
  assert.deepEqual(
    completed.map((plan) => manifest.clips[plan.id].sha256),
    preserved,
  );
  assert.ok(
    Object.values(manifest.clips).every((clip) => clip.status === "complete"),
  );
  assert.equal(
    new Set(Object.values(manifest.clips).map((clip) => clip.sha256)).size,
    3,
  );
  if (revalidatedMedia.size > 0) {
    for (const [id, media] of revalidatedMedia)
      manifest.clips[id].media = media;
    const manifestFile = path.join(directory, "manifest.json");
    fs.writeFileSync(
      `${manifestFile}.pending`,
      JSON.stringify(manifest, null, 2) + "\n",
    );
    fs.renameSync(`${manifestFile}.pending`, manifestFile);
  }
  const stills = [];
  const cachedStills = Array.isArray(cachedReport?.stills)
    ? cachedReport.stills
    : [];
  let reusedStills = 0;
  for (const plan of plans) {
    const holdStart = plan.totalFrames - plan.holdFrames;
    const frames = [
      ...new Set([
        0,
        Math.round(plan.totalFrames / 2),
        ...plan.cues.flatMap((cue) => [
          Math.max(0, cue.startFrame - 1),
          cue.startFrame + plan.transitionFrames,
        ]),
        holdStart,
        plan.totalFrames - 1,
      ]),
    ];
    for (const frame of frames) {
      const file = path.join(directory, `${plan.id}-${frame}.png`);
      const cached = cachedStills.find(
        (still) => still.clip === plan.id && still.frame === frame,
      );
      if (fileMatches(file, cached?.sha256)) {
        reusedStills++;
      } else {
        const composition = await getComposition(plan.id);
        await renderStill({
          serveUrl,
          composition,
          frame,
          output: file,
          logLevel: "error",
        });
      }
      stills.push({
        clip: plan.id,
        frame,
        file,
        sha256: sha256(file),
        state: stateAt(frame, plan),
      });
    }
    assert.equal(
      sha256(path.join(directory, `${plan.id}-${holdStart}.png`)),
      sha256(path.join(directory, `${plan.id}-${plan.totalFrames - 1}.png`)),
    );
  }
  const audioDirectory = path.join(directory, "audio-coverage");
  const mixedWav = path.join(audioDirectory, "mixed.wav");
  const silentVideo = path.join(audioDirectory, "silent.mp4");
  const audioFile = path.join(audioDirectory, "audio-coverage-test.mp4");
  const pcmFile = path.join(audioDirectory, "decoded-audio.f32");
  const audioFiles = [mixedWav, silentVideo, audioFile, pcmFile];
  const audioSourceSha256 = sha256(tailSignalFile);
  let audioTail = cachedReport?.audioTail;
  const reusedAudioTail =
    audioTail?.sourceSha256 === audioSourceSha256 &&
    audioTail?.decodedFractionalTailPeak > 0.1 &&
    audioFiles.every((file) =>
      fileMatches(file, audioTail?.fileHashes?.[path.basename(file)]),
    );
  if (!reusedAudioTail) {
    const audioComposition = await getComposition("AudioCoverage");
    fs.mkdirSync(audioDirectory, { recursive: true });
    await renderMedia({
      serveUrl,
      composition: audioComposition,
      outputLocation: mixedWav,
      codec: "wav",
      audioCodec: "pcm-16",
      sampleRate: 48000,
      logLevel: "error",
    });
    await renderMedia({
      serveUrl,
      composition: audioComposition,
      outputLocation: silentVideo,
      codec: "h264",
      muted: true,
      logLevel: "error",
    });
    // Encode once from lossless mixing; avoid intermediate ADTS priming offsets.
    command("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-i",
      silentVideo,
      "-i",
      mixedWav,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-t",
      String(audioTest.totalFrames / 60),
      audioFile,
    ]);
    verifyMedia({ fps: 60, totalFrames: audioTest.totalFrames }, audioFile);
    command("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-xerror",
      "-i",
      audioFile,
      "-ar",
      "48000",
      "-ac",
      "1",
      "-f",
      "f32le",
      pcmFile,
    ]);
    const pcm = fs.readFileSync(pcmFile);
    let peak = 0;
    for (let sample = 48000; sample < 48192; sample++) {
      assert.ok(sample * 4 + 4 <= pcm.length);
      peak = Math.max(peak, Math.abs(pcm.readFloatLE(sample * 4)));
    }
    assert.ok(peak > 0.1, "Fractional audio tail was truncated");
    audioTail = {
      ...audioTest,
      retainedAudioSeconds: 1.004,
      encoding: "Remotion PCM mixing, then a single AAC encode into MP4",
      decodedFractionalTailPeak: peak,
      sourceSha256: audioSourceSha256,
      fileHashes: Object.fromEntries(
        audioFiles.map((file) => [path.basename(file), sha256(file)]),
      ),
    };
  }
  const verificationDirectory = fs.mkdtempSync(
    path.join(directory, "verification-"),
  );
  fs.writeFileSync(path.join(verificationDirectory, "tests.tap"), unitOutput);
  fs.writeFileSync(
    path.join(verificationDirectory, "typecheck.log"),
    typeCheckOutput,
  );
  const report = {
    generatedAt: new Date().toISOString(),
    kind: "deterministic fixture regression, not a with/without-skill comparison",
    transcriptSha256,
    evalsSha256: sha256(path.join(__dirname, "../evals.json")),
    fontHashes,
    fontFormats: { "chinese.ttf": chineseFontFormat },
    unitTests: {
      sourceSha256: testSourceSha256,
      count: Number(unitOutput.match(/# tests (\d+)/)[1]),
      passed: Number(unitOutput.match(/# pass (\d+)/)[1]),
      failed: Number(unitOutput.match(/# fail (\d+)/)[1]),
      evidence: path.join(verificationDirectory, "tests.tap"),
    },
    typeCheck: {
      passed: true,
      evidence: path.join(verificationDirectory, "typecheck.log"),
    },
    environment,
    implementationHashes,
    assumptions: {
      chineseCharactersPerSecond: 4,
      englishWordsPerSecond: 2.5,
      punctuationPauses: true,
      realNarrationVerified: false,
    },
    clips: plans.map((plan) => ({ ...plan, ...manifest.clips[plan.id] })),
    retry: {
      resumed: resume,
      injectedFailure: resume ? null : plans[1].id,
      rerendered: calls,
      preservedSiblingHashes: preserved,
      reusedStills,
      reusedAudioTail,
    },
    audioTail,
    stills,
  };
  const stagedReport = path.join(verificationDirectory, "report.json");
  fs.writeFileSync(stagedReport, JSON.stringify(report, null, 2) + "\n");
  fs.renameSync(stagedReport, path.join(directory, "report.json"));
  console.log(
    JSON.stringify(
      {
        directory,
        clips: report.clips.map((clip) => ({ id: clip.id, media: clip.media })),
        audioTail: report.audioTail,
      },
      null,
      2,
    ),
  );
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { readVerificationReport, fileMatches, verifyMedia };
