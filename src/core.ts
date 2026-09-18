export interface ImageReference {
  placeholder: string;
  originalPath: string;
  alt: string;
  width?: number;
}

export interface PreparedMarkdown {
  markdown: string;
  images: ImageReference[];
}

const FRONTMATTER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/;
const DANGEROUS_HTML = /<\s*(script|iframe|object|embed|form|input|button|link|meta|base|img)\b/i;

function cleanImagePath(raw: string): string {
  let value = raw.split("|")[0].trim().replace(/^<|>$/g, "");
  value = value.replace(/\s+["'][^"']*["']\s*$/, "").trim();
  try { value = decodeURIComponent(value); } catch { /* keep the original path */ }
  return value;
}

function parseImageWidth(value: string): { value: string; width?: number } {
  const match = value.match(/\|\s*(\d{2,4})(?:x\d{2,4})?\s*$/i);
  if (!match) return { value };
  const width = Number(match[1]);
  if (width < 32 || width > 1920) return { value };
  return { value: value.slice(0, match.index).trim(), width };
}

export function prepareMarkdown(markdown: string, title: string): PreparedMarkdown {
  let body = markdown.replace(FRONTMATTER, "");
  if (DANGEROUS_HTML.test(body)) {
    throw new Error("请移除原始 HTML 中的脚本、嵌入内容或图片标签；图片请使用 Markdown 格式。");
  }

  const codeBlocks: string[] = [];
  body = body.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, block => {
    const token = `DOUCODEBLOCK${codeBlocks.length}END`;
    codeBlocks.push(block);
    return token;
  });

  const images: ImageReference[] = [];
  const addImage = (rawPath: string, rawAlt: string, wikiImage: boolean) => {
    const pathInfo = wikiImage ? parseImageWidth(rawPath) : { value: rawPath };
    const altInfo = wikiImage ? { value: rawAlt } : parseImageWidth(rawAlt);
    const originalPath = cleanImagePath(pathInfo.value);
    const alt = altInfo.value;
    const width = pathInfo.width ?? altInfo.width;
    if (/^https?:\/\//i.test(originalPath)) {
      throw new Error("暂不自动获取外链图片，请先把图片保存到 Obsidian 仓库中。");
    }
    if (/^[a-z]+:/i.test(originalPath) || !originalPath) {
      throw new Error(`不支持的图片地址：${originalPath || rawPath}`);
    }
    const placeholder = `https://dou-publish.local/image/${images.length}`;
    images.push({ placeholder, originalPath, alt, width });
    const widthMarker = width ? ` "dou-width-${width}"` : "";
    return `![${alt}](${placeholder}${widthMarker})`;
  };

  body = body.replace(/!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\((<[^>]+>|[^\n]+?)\)/g,
    (_match, wikiPath: string | undefined, alt: string | undefined, markdownPath: string | undefined) =>
      addImage(wikiPath ?? markdownPath ?? "", alt ?? "", wikiPath !== undefined));

  body = body.split("\n").map(line => {
    if (!/^# /.test(line)) return line;
    if (line.slice(2).trim() === title.trim()) return "";
    return `#${line}`;
  }).join("\n");

  body = body.replace(/DOUCODEBLOCK(\d+)END/g, (_match, index: string) => codeBlocks[Number(index)]);
  return {
    markdown: `---\ntitle: ${JSON.stringify(title)}\n---\n\n# ${title}\n\n${body}`,
    images,
  };
}

export function replaceImagePlaceholders(markdown: string, replacements: Map<string, string>): string {
  let output = markdown;
  for (const [placeholder, url] of replacements) output = output.split(placeholder).join(url);
  return output;
}
