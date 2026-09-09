export interface ImageReference {
  placeholder: string;
  originalPath: string;
  alt: string;
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
  const addImage = (rawPath: string, alt: string) => {
    const originalPath = cleanImagePath(rawPath);
    if (/^https?:\/\//i.test(originalPath)) {
      throw new Error("暂不自动获取外链图片，请先把图片保存到 Obsidian 仓库中。");
    }
    if (/^[a-z]+:/i.test(originalPath) || !originalPath) {
      throw new Error(`不支持的图片地址：${originalPath || rawPath}`);
    }
    const placeholder = `https://dou-publish.local/image/${images.length}`;
    images.push({ placeholder, originalPath, alt });
    return `![${alt}](${placeholder})`;
  };

  body = body.replace(/!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\((<[^>]+>|[^\n]+?)\)/g,
    (_match, wikiPath: string | undefined, alt: string | undefined, markdownPath: string | undefined) =>
      addImage(wikiPath ?? markdownPath ?? "", alt ?? ""));

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

export function friendlyWechatError(code: number | undefined, message?: string): string {
  const known: Record<number, string> = {
    40001: "微信访问凭证已失效，请重新操作。",
    40013: "公众号 AppID 无效，请检查插件设置。",
    40125: "公众号 AppSecret 无效，请检查插件设置。",
    40164: "微信未允许当前出口 IP，请在公众号后台的 IP 白名单中添加它。",
    42001: "微信访问凭证已过期，请重新操作。",
    45009: "微信接口调用次数已达上限，请稍后再试。",
    48001: "当前公众号没有正文图片上传接口权限。",
  };
  return known[code ?? -1] ?? `微信图片处理失败（错误码 ${code ?? "未知"}${message ? `：${message}` : ""}）。`;
}

export function isApprovedWechatImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "mmbiz.qpic.cn" || url.hostname.endsWith(".mmbiz.qpic.cn"));
  } catch { return false; }
}
