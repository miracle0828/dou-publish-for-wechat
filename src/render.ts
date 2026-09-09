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

#output {
  max-width: 860px;
  margin: 0 auto;
}`.trim();
  return [variables, baseCss, themeCss].join("\n\n");
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
  return output;
}

export async function renderWechatHtml(markdown: string, title: string): Promise<string> {
  const style: WechatStyle = {
    primaryColor: "#0F4C81",
    fontFamily: "-apple-system-font,BlinkMacSystemFont, Helvetica Neue, PingFang SC, Hiragino Sans GB, Microsoft YaHei UI, Microsoft YaHei,Arial,sans-serif",
    fontSize: "16px",
    foreground: "0 0% 3.9%",
    blockquoteBackground: "#f7f7f7",
    accentColor: "#6B7280",
    containerBg: "transparent",
  };
  const renderer = initRenderer({
    countStatus: false, citeStatus: true, isMacCodeBlock: true,
    isShowLineNumber: false, legend: "alt",
  });
  const rendered = renderMarkdown(markdown, renderer);
  const processed = postProcessHtml(rendered.html, rendered.readingTime, renderer);
  const content = processed.replace(/<h[12][^>]*>[\s\S]*?<\/h[12]>/, "");
  const css = normalizeThemeCss(buildCss(baseThemeCss, defaultThemeCss, style));
  const inlined = juice(buildHtmlDocument(title, css, content), {
    inlinePseudoElements: true,
    preserveImportant: true,
    resolveCSSVariables: false,
  });
  return modifyHtmlStructure(normalizeInlineCss(inlined, style));
}
