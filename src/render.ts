import baseThemeCss from "../node_modules/baoyu-md/dist/themes/base.css";
import defaultThemeCss from "../node_modules/baoyu-md/dist/themes/default.css";
import githubCodeCss from "../node_modules/baoyu-md/dist/code-themes/github.min.css";
import { initRenderer, postProcessHtml, renderMarkdown } from "baoyu-md/src/renderer.js";
import juice from "juice/client";

interface WechatStyle {
  primaryColor: string;
  fontFamily: string;
  fontSize: string;
  foreground: string;
  blockquoteBackground: string;
  accentColor: string;
  containerBg: string;
  lineHeight: string;
  paragraphSpacing: string;
  imageRadius: string;
}

export interface WechatStyleSettings {
  primaryColor: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  blockquoteStyle: "neutral" | "accent";
  showLineNumbers: boolean;
  imageRadius: number;
}

export const DEFAULT_WECHAT_STYLE_SETTINGS: WechatStyleSettings = {
  primaryColor: "#0F4C81",
  fontSize: 16,
  lineHeight: 1.75,
  paragraphSpacing: 12,
  blockquoteStyle: "neutral",
  showLineNumbers: false,
  imageRadius: 0,
};

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function normalizeSettings(settings?: Partial<WechatStyleSettings>): WechatStyleSettings {
  const primaryColor = /^#[0-9a-f]{6}$/i.test(settings?.primaryColor ?? "")
    ? settings!.primaryColor!
    : DEFAULT_WECHAT_STYLE_SETTINGS.primaryColor;
  return {
    primaryColor,
    fontSize: clamp(settings?.fontSize ?? 16, 14, 20, 16),
    lineHeight: clamp(settings?.lineHeight ?? 1.75, 1.4, 2.2, 1.75),
    paragraphSpacing: clamp(settings?.paragraphSpacing ?? 12, 0, 32, 12),
    blockquoteStyle: settings?.blockquoteStyle === "accent" ? "accent" : "neutral",
    showLineNumbers: Boolean(settings?.showLineNumbers),
    imageRadius: clamp(settings?.imageRadius ?? 0, 0, 24, 0),
  };
}

function normalizeThemeCss(css: string): string {
  return css
    .replace(/#output\s*\{/g, "body {")
    .replace(/#output\s+/g, "")
    .replace(/^#output\s*/gm, "");
}

function buildCss(baseCss: string, themeCss: string, style: WechatStyle): string {
  const variables = `
:root {
  --md-primary-color: ${style.primaryColor};
  --md-font-family: ${style.fontFamily};
  --md-font-size: ${style.fontSize};
  --foreground: ${style.foreground};
  --blockquote-background: ${style.blockquoteBackground};
  --md-accent-color: ${style.accentColor};
  --md-container-bg: ${style.containerBg};
}

body {
  margin: 0;
  padding: 24px;
  background: #ffffff;
}
`.trim();

  const overrides = `
#output {
  max-width: 860px;
  margin: 0 auto;
  font-size: ${style.fontSize};
  line-height: ${style.lineHeight};
}

#output .container {
  font-size: ${style.fontSize};
  line-height: ${style.lineHeight};
}

#output p {
  margin-top: 0;
  margin-bottom: ${style.paragraphSpacing};
}

#output img {
  border-radius: ${style.imageRadius};
}`.trim();
  return [variables, baseCss, themeCss, overrides].join("\n\n");
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtmlDocument(title: string, css: string, html: string): string {
  return [
    "<!doctype html>",
    "<html><head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtmlAttribute(title)}</title>`,
    `<style>${css}</style>`,
    `<style>${githubCodeCss}</style>`,
    "</head><body><div id=\"output\">",
    html,
    "</div></body></html>",
  ].join("\n");
}

function normalizeCssText(cssText: string, style: WechatStyle): string {
  return cssText
    .replace(/var\(--md-primary-color\)/g, style.primaryColor)
    .replace(/var\(--md-font-family\)/g, style.fontFamily)
    .replace(/var\(--md-font-size\)/g, style.fontSize)
    .replace(/var\(--blockquote-background\)/g, style.blockquoteBackground)
    .replace(/var\(--md-accent-color\)/g, style.accentColor)
    .replace(/var\(--md-container-bg\)/g, style.containerBg)
    .replace(/hsl\(var\(--foreground\)\)/g, "#3f3f3f")
    .replace(/--(?:md-primary-color|md-font-family|md-font-size|blockquote-background|md-accent-color|md-container-bg|foreground):\s*[^;]+;?/g, "");
}

function normalizeInlineCss(html: string, style: WechatStyle): string {
  return html
    .replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attrs: string, cssText: string) => `<style${attrs}>${normalizeCssText(cssText, style)}</style>`)
    .replace(/style="([^"]*)"/gi, (_match, cssText: string) => `style="${normalizeCssText(cssText, style)}"`)
    .replace(/style='([^']*)'/gi, (_match, cssText: string) => `style='${normalizeCssText(cssText, style)}'`);
}

function modifyHtmlStructure(html: string): string {
  const nestedList = /<li([^>]*)>([\s\S]*?)(<ul[\s\S]*?<\/ul>|<ol[\s\S]*?<\/ol>)<\/li>/i;
  let output = html;
  while (nestedList.test(output)) output = output.replace(nestedList, "<li$1>$2</li>$3");
  output = output
    .replace(/(<li\b[^>]*>)\s*•?\s*\[\s\]\s*/gi, "$1☐ ")
    .replace(/(<li\b[^>]*>)\s*•?\s*\[[xX]\]\s*/g, "$1☑ ");
  output = output.replace(/<input\b([^>]*\btype=["']checkbox["'][^>]*)>/gi, (_match, attributes: string) => {
    const checked = /(?:^|\s)checked(?:\s|=|$)/i.test(attributes);
    return `<span aria-hidden="true">${checked ? "☑" : "☐"}</span>`;
  });
  return output;
}

function applyImageWidths(html: string): string {
  return html.replace(/<img\b([^>]*?)\s+title=["']dou-width-(\d{2,4})["']([^>]*)>/gi,
    (_match, before: string, width: string, after: string) =>
      `<img${before}${after} width="${width}" style="width:${width}px;max-width:100%;height:auto;">`);
}

export async function renderWechatHtml(markdown: string, title: string, inputSettings?: Partial<WechatStyleSettings>): Promise<string> {
  const settings = normalizeSettings(inputSettings);
  const style: WechatStyle = {
    primaryColor: settings.primaryColor,
    fontFamily: "-apple-system-font,BlinkMacSystemFont, Helvetica Neue, PingFang SC, Hiragino Sans GB, Microsoft YaHei UI, Microsoft YaHei,Arial,sans-serif",
    fontSize: `${settings.fontSize}px`,
    foreground: "0 0% 3.9%",
    blockquoteBackground: settings.blockquoteStyle === "accent" ? `${settings.primaryColor}12` : "#f7f7f7",
    accentColor: "#6B7280",
    containerBg: "transparent",
    lineHeight: String(settings.lineHeight),
    paragraphSpacing: `${settings.paragraphSpacing}px`,
    imageRadius: `${settings.imageRadius}px`,
  };
  const renderer = initRenderer({
    countStatus: false, citeStatus: true, isMacCodeBlock: true,
    isShowLineNumber: settings.showLineNumbers, legend: "alt",
  });
  const rendered = renderMarkdown(markdown, renderer);
  const processed = postProcessHtml(rendered.html, rendered.readingTime, renderer);
  const content = applyImageWidths(processed.replace(/<h[12][^>]*>[\s\S]*?<\/h[12]>/, ""));
  const css = normalizeThemeCss(buildCss(baseThemeCss, defaultThemeCss, style));
  const inlined = juice(buildHtmlDocument(title, css, content), {
    inlinePseudoElements: true,
    preserveImportant: true,
    resolveCSSVariables: false,
  });
  return modifyHtmlStructure(normalizeInlineCss(inlined, style));
}
