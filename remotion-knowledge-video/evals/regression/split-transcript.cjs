const { parsers } = require("prettier/plugins/markdown");
const yaml = require("js-yaml");

const textOf = (node) =>
  node.value ?? (node.children ?? []).map(textOf).join("");

async function splitTranscript(source) {
  let parsedSource = source;
  let ast = await parsers.markdown.parse(parsedSource);
  let metadataEnd = 0;
  const first = ast.children[0];
  if (first?.type === "frontMatter") {
    let metadata;
    try {
      metadata = yaml.load(first.value);
    } catch {
      metadata = null;
    }
    if (
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      Object.keys(metadata).length > 0
    ) {
      metadataEnd = first.position.end.offset;
    } else {
      // Keep offsets while preventing an invalid YAML guess from swallowing speech.
      parsedSource = source.replace(/^(\uFEFF?)---(?=\r?\n)/, "$1***");
      ast = await parsers.markdown.parse(parsedSource);
    }
  }
  const sections = [];
  let start = metadataEnd;
  let nodes = [];
  const append = (end) => {
    const raw = source.slice(start, end);
    sections.push({
      start,
      end,
      raw,
      empty: raw.trim().length === 0,
      title: textOf(nodes.find((node) => node.type === "heading") ?? {}),
      paragraphs: nodes.filter((node) => node.type === "paragraph").map(textOf),
    });
  };
  for (const node of ast.children) {
    if (node.position.start.offset < metadataEnd) continue;
    if (node.type === "thematicBreak") {
      append(node.position.start.offset);
      start = node.position.end.offset;
      nodes = [];
    } else {
      nodes.push(node);
    }
  }
  append(source.length);
  return { metadataEnd, sections };
}

module.exports = { splitTranscript };
