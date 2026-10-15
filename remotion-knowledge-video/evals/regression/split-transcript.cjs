const { parsers } = require("prettier/plugins/markdown");
const yaml = require("js-yaml");

const textOf = (node) => {
  if (node.type === "break") return " ";
  if (node.type === "html")
    return /^<br(?:\s[^>]*)?\/?\s*>$/i.test(node.value) ? " " : "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
};

function paragraphsOf(node) {
  if (["code", "html", "frontMatter"].includes(node.type)) return [];
  if (node.type === "paragraph") {
    const text = textOf(node)
      .replace(/\s+/gu, " ")
      .replace(/(\p{Script=Han}) +(?=\p{Script=Han})/gu, "$1")
      .trim();
    return text ? [text] : [];
  }
  return (node.children ?? []).flatMap(paragraphsOf);
}

function isKnownMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, field]) =>
        ["title", "language"].includes(key) &&
        typeof field === "string" &&
        field.trim().length > 0,
    )
  );
}

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
    if (isKnownMetadata(metadata)) {
      metadataEnd = first.position.end.offset;
    } else {
      // Keep offsets while preventing a front-matter guess from swallowing speech.
      parsedSource = source.replace(/^(\uFEFF?)---(?=\r?\n)/, "$1***");
      ast = await parsers.markdown.parse(parsedSource);
    }
  }
  // A standalone br otherwise starts an HTML block that swallows following speech.
  const stripBreakBlocks = (node) => {
    if (
      node.type === "html" &&
      /^[ \t]*<br(?:[ \t][^>\r\n]*)?\/?[ \t]*>[ \t]*\r?\n/i.test(node.value)
    ) {
      const { start, end } = node.position;
      const cleaned = parsedSource
        .slice(start.offset, end.offset)
        .replace(
          /^(?:[ \t>]*<br(?:[ \t][^>\r\n]*)?\/?[ \t]*>[ \t]*\r?\n)+/i,
          (prefix) =>
            prefix.replace(/<br[^>\r\n]*>/gi, (tag) => " ".repeat(tag.length)),
        );
      parsedSource =
        parsedSource.slice(0, start.offset) +
        cleaned +
        parsedSource.slice(end.offset);
    }
    for (const child of node.children ?? []) stripBreakBlocks(child);
  };
  // Reparsing can expose another br block inside a list or quote.
  for (;;) {
    const beforeCleanup = parsedSource;
    stripBreakBlocks(ast);
    if (parsedSource === beforeCleanup) break;
    ast = await parsers.markdown.parse(parsedSource);
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
      paragraphs: nodes.flatMap(paragraphsOf),
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
