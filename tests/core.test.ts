import test from "node:test";
import assert from "node:assert/strict";
import { friendlyWechatError, isApprovedWechatImageUrl, prepareMarkdown, replaceImagePlaceholders } from "../src/core";

test("removes a duplicate title and preserves other H1 as H2", () => {
  const result = prepareMarkdown("---\ntitle: old\n---\n# 文章\n正文\n# 结尾", "文章");
  assert.match(result.markdown, /## 结尾/);
  assert.equal(result.markdown.split("\n# 文章").length, 2);
});

test("extracts wiki and standard local images", () => {
  const result = prepareMarkdown("![[photo.png|400]]\n![](image with spaces.png)", "文章");
  assert.deepEqual(result.images.map(image => image.originalPath), ["photo.png", "image with spaces.png"]);
  assert.match(result.markdown, /dou-publish\.local\/image\/1/);
});

test("does not parse image examples inside fenced code", () => {
  const result = prepareMarkdown("```md\n![[missing.png]]\n```", "文章");
  assert.equal(result.images.length, 0);
  assert.match(result.markdown, /!\[\[missing\.png\]\]/);
});

test("blocks remote images and unsafe raw HTML", () => {
  assert.throws(() => prepareMarkdown("![](https://example.com/a.png)", "文章"), /外链图片/);
  assert.throws(() => prepareMarkdown("<script>alert(1)</script>", "文章"), /原始 HTML/);
});

test("replaces image placeholders", () => {
  const source = "![](https://dou-publish.local/image/0)";
  assert.equal(replaceImagePlaceholders(source, new Map([["https://dou-publish.local/image/0", "https://mmbiz.qpic.cn/a"]])), "![](https://mmbiz.qpic.cn/a)");
});

test("validates WeChat image hosts and explains common errors", () => {
  assert.equal(isApprovedWechatImageUrl("https://mmbiz.qpic.cn/a"), true);
  assert.equal(isApprovedWechatImageUrl("https://mmbiz.qpic.cn.evil.test/a"), false);
  assert.match(friendlyWechatError(40164), /IP 白名单/);
});
