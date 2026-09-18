import test from "node:test";
import assert from "node:assert/strict";
import { renderWechatHtml } from "../src/render";

test("renders the embedded default theme with inline styles", async () => {
  const html = await renderWechatHtml("---\ntitle: 文章\n---\n\n# 文章\n\n## 第二章\n\n正文 **重点**", "文章");
  assert.doesNotMatch(html, />文章<\/h1>/);
  assert.match(html, />第二章<\/h2>/);
  assert.match(html, /style=/);
  assert.match(html, /#0F4C81|rgb\(15, 76, 129\)/i);
});

test("applies visual settings and preserves requested image width", async () => {
  const html = await renderWechatHtml(
    "---\ntitle: 文章\n---\n\n# 文章\n\n![图](data:image/png;base64,aGVsbG8= \"dou-width-400\")",
    "文章",
    { primaryColor: "#B45309", fontSize: 18, lineHeight: 1.9, paragraphSpacing: 16, imageRadius: 8 },
  );
  assert.match(html, /width="400"/);
  assert.match(html, /width:\s*400px/i);
  assert.match(html, /font-size:\s*18px/i);
  assert.match(html, /line-height:\s*1\.9/i);
});

test("converts task checkboxes into stable text symbols", async () => {
  const html = await renderWechatHtml("- [ ] 未完成\n- [x] 已完成", "任务");
  assert.doesNotMatch(html, /<input/i);
  assert.match(html, /☐/);
  assert.match(html, /☑/);
});
