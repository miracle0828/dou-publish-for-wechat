import baseThemeCss from "../node_modules/baoyu-md/dist/themes/base.css";
import defaultThemeCss from "../node_modules/baoyu-md/dist/themes/default.css";
import githubCodeCss from "../node_modules/baoyu-md/dist/code-themes/github.min.css";

// @ts-ignore -- baoyu-md does not publish declarations beside its compiled ESM entry
import { buildCss, buildHtmlDocument, inlineCss, initRenderer, modifyHtmlStructure, normalizeInlineCss, normalizeThemeCss, postProcessHtml, removeFirstHeading, renderMarkdown } from "../node_modules/baoyu-md/dist/index.js";

export async function renderWechatHtml(markdown: string, title: string): Promise<string> {
  const style = {
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
  let content = postProcessHtml(rendered.html, rendered.readingTime, renderer);
  content = removeFirstHeading(content);
  const css = normalizeThemeCss(buildCss(baseThemeCss, defaultThemeCss, style));
  const document = buildHtmlDocument({ title }, css, content, githubCodeCss);
  const inlined = normalizeInlineCss(await inlineCss(document), style);
  return modifyHtmlStructure(inlined);
}
