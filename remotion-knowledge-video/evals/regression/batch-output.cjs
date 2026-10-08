const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function reserveBatch(parent, name) {
  fs.mkdirSync(parent, { recursive: true });
  for (let suffix = 0; ; suffix++) {
    const directory = path.join(
      parent,
      suffix ? `${name}-${suffix + 1}` : name,
    );
    try {
      fs.mkdirSync(directory);
      return directory;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

async function renderBatch(directory, plans, render, verify) {
  const manifestPath = path.join(directory, "manifest.json");
  const planSetSha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify(plans))
    .digest("hex");
  const hasManifest = fs.existsSync(manifestPath);
  const manifest = hasManifest
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { planSetSha256, clips: {} };
  if (manifest.planSetSha256 !== planSetSha256) {
    throw new Error(
      "Batch plan changed or is unverifiable; reserve a new batch",
    );
  }
  const saveManifest = () =>
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  // Register the entire ordered plan before rendering can be interrupted.
  if (!hasManifest) saveManifest();
  for (const plan of plans) {
    const file = path.join(directory, `${plan.id}.mp4`);
    const previous = manifest.clips[plan.id];
    const inputSha256 = crypto
      .createHash("sha256")
      .update(JSON.stringify(plan))
      .digest("hex");
    if (previous?.inputSha256 && previous.inputSha256 !== inputSha256) {
      throw new Error("Input changed; reserve a new batch");
    }
    if (previous?.status === "complete") {
      if (!fs.existsSync(file) || sha256(file) !== previous.sha256) {
        throw new Error("Completed output changed");
      }
      continue;
    }
    if (fs.existsSync(file))
      throw new Error("Refusing to overwrite an untracked output");
    const pending = path.join(directory, `${plan.id}.pending.mp4`);
    try {
      await render(plan, pending);
      const media = await verify(plan, pending);
      fs.renameSync(pending, file);
      manifest.clips[plan.id] = {
        status: "complete",
        inputSha256,
        file,
        sha256: sha256(file),
        media,
      };
    } catch (error) {
      fs.rmSync(pending, { force: true });
      manifest.clips[plan.id] = {
        status: "failed",
        inputSha256,
        error: error.message,
      };
    }
    saveManifest();
  }
  return manifest;
}

module.exports = { reserveBatch, renderBatch, sha256 };
