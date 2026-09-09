import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, requestUrl } from "obsidian";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { friendlyWechatError, isApprovedWechatImageUrl, prepareMarkdown, replaceImagePlaceholders, type ImageReference } from "./core";
import { renderWechatHtml } from "./render";

const VIEW_TYPE = "dou-publish-preview";
const MAX_UPLOAD_BYTES = 1024 * 1024;

interface PluginSettings { appId: string; appSecret: string; imageCache: Record<string, string>; }
interface LoadedArticle { file: TFile; source: string; title: string; prepared: ReturnType<typeof prepareMarkdown>; buffers: Map<string, ArrayBuffer>; html: string; }
const DEFAULT_SETTINGS: PluginSettings = { appId: "", appSecret: "", imageCache: {} };

function mimeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".gif" ? "image/gif" : extension === ".webp" ? "image/webp" : "image/jpeg";
}

function toDataUrl(buffer: ArrayBuffer, path: string): string {
  return `data:${mimeFor(path)};base64,${Buffer.from(buffer).toString("base64")}`;
}

function exactArrayBuffer(value: Buffer): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function sanitizeHtml(html: string, copying: boolean): { documentHtml: string; fragment: string; text: string } {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script,iframe,object,embed,form,input,button,link,meta,base").forEach(el => el.remove());
  parsed.querySelectorAll("*").forEach(el => {
    for (const attribute of Array.from(el.attributes)) {
      if (/^on/i.test(attribute.name)) el.removeAttribute(attribute.name);
      if (attribute.name === "href" && !/^(https?:|mailto:|#)/i.test(attribute.value.trim())) el.removeAttribute(attribute.name);
      if (attribute.name === "src") {
        const src = attribute.value.trim();
        const allowed = copying ? isApprovedWechatImageUrl(src) : /^(data:image\/|https:\/\/dou-publish\.local\/)/i.test(src);
        if (!allowed) el.removeAttribute(attribute.name);
      }
    }
  });
  const output = parsed.getElementById("output") ?? parsed.body;
  return { documentHtml: `<!doctype html>${parsed.documentElement.outerHTML}`, fragment: output.innerHTML, text: output.textContent ?? "" };
}

class WechatClient {
  private token?: { value: string; expiresAt: number };
  constructor(private plugin: DouPublishPlugin) {}

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const { appId, appSecret } = this.plugin.settings;
    if (!appId || !appSecret) throw new Error("正文中有图片。请先在插件设置中填写公众号 AppID 和 AppSecret。");
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
    const response = await requestUrl({ url, method: "GET", throw: false });
    const data = response.json as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
    if (!data.access_token) throw new Error(friendlyWechatError(data.errcode, data.errmsg));
    this.token = { value: data.access_token, expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 7200) - 300) * 1000 };
    return data.access_token;
  }

  private normalizeImage(input: ArrayBuffer, path: string): { bytes: Buffer; filename: string; mime: string } {
    let bytes = Buffer.from(input);
    const extension = extname(path).toLowerCase();
    if (extension === ".gif") {
      if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(`GIF 图片超过 1 MB，请先压缩：${path}`);
      return { bytes, filename: "image.gif", mime: "image/gif" };
    }
    if (bytes.length <= MAX_UPLOAD_BYTES && [".jpg", ".jpeg", ".png"].includes(extension)) {
      return { bytes, filename: extension === ".png" ? "image.png" : "image.jpg", mime: mimeFor(path) };
    }
    const { nativeImage } = require("electron") as { nativeImage: { createFromBuffer(value: Buffer): any } };
    let image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error(`无法读取图片：${path}`);
    const size = image.getSize();
    if (size.width > 1920) image = image.resize({ width: 1920, quality: "best" });
    for (const quality of [88, 82, 75, 68, 60, 52, 45]) {
      bytes = image.toJPEG(quality);
      if (bytes.length <= MAX_UPLOAD_BYTES) return { bytes, filename: "image.jpg", mime: "image/jpeg" };
    }
    throw new Error(`图片压缩后仍超过 1 MB，请手动缩小：${path}`);
  }

  async upload(image: ImageReference, buffer: ArrayBuffer): Promise<string> {
    const account = this.plugin.settings.appId;
    const hash = createHash("sha256").update(account).update(Buffer.from(buffer)).digest("hex");
    const cached = this.plugin.settings.imageCache[hash];
    if (cached && isApprovedWechatImageUrl(cached)) return cached;
    const normalized = this.normalizeImage(buffer, image.originalPath);
    const boundary = `----DouPublish${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${normalized.filename}"\r\nContent-Type: ${normalized.mime}\r\n\r\n`);
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, normalized.bytes, footer]);
    const send = async () => {
      const token = await this.accessToken();
      const response = await requestUrl({
        url: `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`,
        method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body: exactArrayBuffer(body), throw: false,
      });
      return response.json as { url?: string; errcode?: number; errmsg?: string };
    };
    let data = await send();
    if (data.errcode === 40001 || data.errcode === 42001) { this.clearToken(); data = await send(); }
    if (!data.url || !isApprovedWechatImageUrl(data.url)) throw new Error(friendlyWechatError(data.errcode, data.errmsg));
    this.plugin.settings.imageCache[hash] = data.url;
    await this.plugin.saveSettings();
    return data.url;
  }

  clearToken() { this.token = undefined; }
}

class PreviewView extends ItemView {
  plugin!: DouPublishPlugin;
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
        previewReplacements.set(image.placeholder, toDataUrl(buffer, target.path));
      }
      const html = sanitizeHtml(await renderWechatHtml(replaceImagePlaceholders(prepared.markdown, previewReplacements), title), false).documentHtml;
      this.article = { file, source, title, prepared, buffers, html };
      this.frame.srcdoc = html;
      this.statusEl.setText(`${title} · ${prepared.images.length} 张配图 · 预览不会上传图片`);
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
    this.busy = true; this.updateButtons(); this.statusEl.setText("正在准备图片和带格式正文…");
    try {
      const replacements = new Map<string, string>();
      for (let index = 0; index < this.article.prepared.images.length; index++) {
        const image = this.article.prepared.images[index];
        this.statusEl.setText(`正在处理第 ${index + 1}/${this.article.prepared.images.length} 张图片…`);
        const buffer = this.article.buffers.get(image.placeholder);
        if (!buffer) throw new Error(`缺少图片数据：${image.originalPath}`);
        replacements.set(image.placeholder, await this.plugin.wechat.upload(image, buffer));
      }
      const rendered = await renderWechatHtml(replaceImagePlaceholders(this.article.prepared.markdown, replacements), this.article.title);
      const safe = sanitizeHtml(rendered, true);
      const { clipboard } = require("electron") as { clipboard: { write(data: { html: string; text: string }): void } };
      clipboard.write({ html: safe.fragment, text: safe.text });
      this.statusEl.setText(`已复制：${this.article.prepared.images.length} 张配图。到公众号正文区按 Ctrl+V；标题和封面单独填写。`);
      new Notice("已复制公众号格式和图片");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusEl.setText(message); new Notice(message, 8000);
    } finally { this.busy = false; this.updateButtons(); }
  }
}

class SettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: DouPublishPlugin) { super(app, plugin); }
  display() {
    const container = this.containerEl; container.empty();
    container.createEl("h2", { text: "Dou Publish for WeChat" });
    container.createEl("p", { text: "预览完全在本地完成。只有点击“复制到公众号”时，正文中的本地图片才会上传到微信；插件不会创建草稿，也不会自动发布文章。" });
    container.createEl("p", { cls: "setting-item-description", text: "AppID 与 AppSecret 保存在当前 Obsidian 仓库的插件 data.json 中，只会发送到微信官方接口 api.weixin.qq.com。公开分享仓库或截图前，请勿包含该 data.json。" });
    new Setting(container).setName("公众号 AppID").setDesc("在微信公众平台的开发设置中查看。纯文字文章可留空。")
      .addText(text => text.setPlaceholder("wx…").setValue(this.plugin.settings.appId).onChange(async value => { this.plugin.settings.appId = value.trim(); this.plugin.wechat.clearToken(); await this.plugin.saveSettings(); }));
    new Setting(container).setName("公众号 AppSecret").setDesc("用于把本地配图上传到你的公众号素材服务。")
      .addText(text => { text.inputEl.type = "password"; text.setPlaceholder("仅保存在本机").setValue(this.plugin.settings.appSecret).onChange(async value => { this.plugin.settings.appSecret = value.trim(); this.plugin.wechat.clearToken(); await this.plugin.saveSettings(); }); });
    new Setting(container).setName("测试公众号配置").setDesc("向微信申请一次访问凭证，检查 AppID、AppSecret 与 IP 白名单。")
      .addButton(button => button.setButtonText("测试").onClick(async () => {
        try { await this.plugin.wechat.accessToken(); new Notice("公众号配置可用"); }
        catch (error) { new Notice(error instanceof Error ? error.message : String(error), 8000); }
      }));
    new Setting(container).setName("清除图片地址缓存").setDesc("下次复制时会重新上传正文配图。")
      .addButton(button => button.setButtonText("清除缓存").onClick(async () => { this.plugin.settings.imageCache = {}; await this.plugin.saveSettings(); new Notice("图片缓存已清除"); }));
  }
}

export default class DouPublishPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  wechat = new WechatClient(this);
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.registerView(VIEW_TYPE, leaf => { const view = new PreviewView(leaf); view.plugin = this; return view; });
    this.addRibbonIcon("newspaper", "预览当前文章（公众号）", () => void this.openPreview());
    this.addCommand({ id: "preview-current-article", name: "预览当前文章", callback: () => void this.openPreview() });
    this.addSettingTab(new SettingsTab(this.app, this));
  }
  async saveSettings() { await this.saveData(this.settings); }
  private async openPreview() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") { new Notice("请先打开 Markdown 文章"); return; }
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) leaf = this.app.workspace.getRightLeaf(false) as WorkspaceLeaf;
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    await (leaf.view as PreviewView).loadArticle(file);
  }
}
