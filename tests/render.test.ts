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
