import { ItemView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { nativeImage, type NativeImage } from "electron";
import { extname } from "node:path";
import { prepareMarkdown, replaceImagePlaceholders } from "./core";
import { renderWechatHtml } from "./render";

const VIEW_TYPE = "dou-publish-preview";
const MAX_STATIC_IMAGE_BYTES = 2 * 1024 * 1024;
const LARGE_GIF_BYTES = 10 * 1024 * 1024;

interface LoadedArticle {
  file: TFile;
  source: string;
  title: string;
  prepared: ReturnType<typeof prepareMarkdown>;
  buffers: Map<string, ArrayBuffer>;
  html: string;
}

function mimeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".gif" ? "image/gif" : extension === ".webp" ? "image/webp" : "image/jpeg";
}

function toDataUrl(buffer: ArrayBuffer | Buffer, mime: string): string {
  return `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;
}

function isSafeImageDataUrl(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function clipboardImageDataUrl(input: ArrayBuffer, path: string): { url: string; largeGif: boolean } {
  const original = Buffer.from(input);
  const extension = extname(path).toLowerCase();
  if (extension === ".gif") {
    return { url: toDataUrl(original, "image/gif"), largeGif: original.length > LARGE_GIF_BYTES };
  }

  if (original.length <= MAX_STATIC_IMAGE_BYTES && [".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    return { url: toDataUrl(original, mimeFor(path)), largeGif: false };
  }

  let image: NativeImage = nativeImage.createFromBuffer(original);
  if (image.isEmpty()) throw new Error(`无法读取图片：${path}`);
  const size = image.getSize();
  if (size.width > 1920) image = image.resize({ width: 1920, quality: "best" });

  let compressed = image.toJPEG(82);
  for (const quality of [75, 68, 60, 52, 45]) {
    if (compressed.length <= MAX_STATIC_IMAGE_BYTES) break;
    compressed = image.toJPEG(quality);
  }
  if (compressed.length > MAX_STATIC_IMAGE_BYTES) throw new Error(`图片压缩后仍过大，请先缩小：${path}`);
  return { url: toDataUrl(compressed, "image/jpeg"), largeGif: false };
}

function sanitizeHtml(html: string): { documentHtml: string; fragment: string; text: string } {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script,iframe,object,embed,form,input,button,link,meta,base").forEach(el => el.remove());
  parsed.querySelectorAll("*").forEach(el => {
    for (const attribute of Array.from(el.attributes)) {
      if (/^on/i.test(attribute.name)) el.removeAttribute(attribute.name);
      if (attribute.name === "href" && !/^(https?:|mailto:|#)/i.test(attribute.value.trim())) el.removeAttribute(attribute.name);
      if (attribute.name === "src") {
        const src = attribute.value.trim();
        if (!isSafeImageDataUrl(src) && !/^https:\/\/dou-publish\.local\//i.test(src)) el.removeAttribute(attribute.name);
      }
    }
  });
  const output = parsed.getElementById("output") ?? parsed.body;
  return { documentHtml: `<!doctype html>${parsed.documentElement.outerHTML}`, fragment: output.innerHTML, text: output.textContent ?? "" };
}

async function writeRichClipboard(html: string, text: string): Promise<void> {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== "function" || typeof ClipboardItem === "undefined") {
    throw new Error("当前 Obsidian 环境不支持富文本剪贴板，请升级桌面版 Obsidian。");
  }
  const item = new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([text], { type: "text/plain" }),
  });
  await navigator.clipboard.write([item]);
}

class PreviewView extends ItemView {
  private article?: LoadedArticle;
  private statusEl!: HTMLElement;
  private frame!: HTMLIFrameElement;
  private refreshButton!: HTMLButtonElement;
  private copyButton!: HTMLButtonElement;
  private busy = false;
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "公众号预览"; }
  getIcon() { return "newspaper"; }

  async onOpen() {
    this.contentEl.empty(); this.contentEl.addClass("dou-publish-view");
    const toolbar = this.contentEl.createDiv({ cls: "dou-toolbar" });
    this.refreshButton = toolbar.createEl("button", { text: "刷新预览" });
    this.copyButton = toolbar.createEl("button", { text: "复制到公众号", cls: "mod-cta" });
    this.refreshButton.onclick = () => void this.loadArticle(this.article?.file ?? this.app.workspace.getActiveFile());
    this.copyButton.onclick = () => void this.copyArticle();
    this.statusEl = this.contentEl.createDiv({ cls: "dou-status", text: "打开一篇 Markdown 文章，然后刷新预览。" });
    this.frame = this.contentEl.createEl("iframe", { cls: "dou-frame" });
    this.frame.setAttribute("sandbox", ""); this.frame.setAttribute("title", "微信公众号文章预览");
    this.updateButtons();
  }

  private updateButtons() { this.refreshButton.disabled = this.busy; this.copyButton.disabled = this.busy || !this.article; }

  async loadArticle(file: TFile | null) {
    if (this.busy) return;
    if (!(file instanceof TFile) || file.extension !== "md") { new Notice("请先打开 Markdown 文章"); return; }
    this.busy = true; this.updateButtons(); this.statusEl.setText("正在生成本地预览…");
    try {
      const source = await this.app.vault.read(file);
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const title = String(frontmatter?.title || file.basename);
      const prepared = prepareMarkdown(source, title);
      const buffers = new Map<string, ArrayBuffer>();
      const previewReplacements = new Map<string, string>();
      for (const image of prepared.images) {
        const target = this.app.metadataCache.getFirstLinkpathDest(image.originalPath, file.path);
        if (!target) throw new Error(`找不到配图：${image.originalPath}`);
        const buffer = await this.app.vault.readBinary(target);
        buffers.set(image.placeholder, buffer);
        previewReplacements.set(image.placeholder, toDataUrl(buffer, mimeFor(target.path)));
      }
      const html = sanitizeHtml(await renderWechatHtml(replaceImagePlaceholders(prepared.markdown, previewReplacements), title)).documentHtml;
      this.article = { file, source, title, prepared, buffers, html };
      this.frame.srcdoc = html;
      this.statusEl.setText(`${title} · ${prepared.images.length} 张配图 · 全程本地预览`);
    } catch (error) {
      this.article = undefined; this.frame.srcdoc = "";
      const message = error instanceof Error ? error.message : String(error);
      this.statusEl.setText(message); new Notice(message);
    } finally { this.busy = false; this.updateButtons(); }
  }

  private async copyArticle() {
    if (!this.article || this.busy) return;
    if (await this.app.vault.read(this.article.file) !== this.article.source) {
      await this.loadArticle(this.article.file); new Notice("文章已修改，预览已刷新。请检查后再次点击复制。"); return;
    }
    this.busy = true; this.updateButtons(); this.statusEl.setText("正在把图片写入富文本剪贴板…");
    try {
      const replacements = new Map<string, string>();
      const largeGifs: string[] = [];
      for (let index = 0; index < this.article.prepared.images.length; index++) {
        const image = this.article.prepared.images[index];
        this.statusEl.setText(`正在处理第 ${index + 1}/${this.article.prepared.images.length} 张图片…`);
        const buffer = this.article.buffers.get(image.placeholder);
        if (!buffer) throw new Error(`缺少图片数据：${image.originalPath}`);
        const result = clipboardImageDataUrl(buffer, image.originalPath);
        replacements.set(image.placeholder, result.url);
        if (result.largeGif) largeGifs.push(image.originalPath);
      }
      const rendered = await renderWechatHtml(replaceImagePlaceholders(this.article.prepared.markdown, replacements), this.article.title);
      const safe = sanitizeHtml(rendered);
      await writeRichClipboard(safe.fragment, safe.text);
      const warning = largeGifs.length ? `；${largeGifs.length} 张 GIF 超过 10 MB，粘贴可能较慢` : "";
      this.statusEl.setText(`已复制：${this.article.prepared.images.length} 张配图${warning}。到公众号正文区按 Ctrl+V。`);
      new Notice(largeGifs.length ? "已复制，较大的 GIF 粘贴可能较慢" : "已复制公众号格式和图片");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusEl.setText(message); new Notice(message, 8000);
    } finally { this.busy = false; this.updateButtons(); }
  }
}

export default class DouPublishPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, leaf => new PreviewView(leaf));
    this.addRibbonIcon("newspaper", "预览当前文章（公众号）", () => void this.openPreview());
    this.addCommand({ id: "preview-current-article", name: "预览当前文章", callback: () => void this.openPreview() });
  }

  private async openPreview() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") { new Notice("请先打开 Markdown 文章"); return; }
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) leaf = this.app.workspace.getRightLeaf(false) as WorkspaceLeaf;
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    await (leaf.view as PreviewView).loadArticle(file);
  }
}
