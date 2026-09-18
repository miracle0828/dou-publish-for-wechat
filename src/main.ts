import { ItemView, Notice, Plugin, PluginSettingTab, Setting, type SettingDefinitionItem, TFile, WorkspaceLeaf } from "obsidian";
import { nativeImage, type NativeImage } from "electron";
import { extname } from "node:path";
import { prepareMarkdown, replaceImagePlaceholders } from "./core";
import { DEFAULT_WECHAT_STYLE_SETTINGS, renderWechatHtml, type WechatStyleSettings } from "./render";

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
  totalImageBytes: number;
  largeImageCount: number;
}

function mimeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".gif" ? "image/gif" : extension === ".webp" ? "image/webp" : "image/jpeg";
}

function toDataUrl(buffer: ArrayBuffer | Buffer, mime: string): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
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
  constructor(leaf: WorkspaceLeaf, private readonly plugin: DouPublishPlugin) { super(leaf); }
  private article?: LoadedArticle;
  private statusEl!: HTMLElement;
  private frame!: HTMLIFrameElement;
  private refreshButton!: HTMLButtonElement;
  private copyButton!: HTMLButtonElement;
  private busy = false;
  private reloadRequested = false;
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

  async refresh(): Promise<void> {
    await this.loadArticle(this.article?.file ?? this.app.workspace.getActiveFile());
  }

  async loadArticle(file: TFile | null) {
    if (this.busy) { this.reloadRequested = true; return; }
    if (!(file instanceof TFile) || file.extension !== "md") { new Notice("请先打开 Markdown 文章"); return; }
    this.busy = true; this.updateButtons(); this.statusEl.setText("正在生成本地预览…");
    try {
      const source = await this.app.vault.read(file);
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const title = String(frontmatter?.title || file.basename);
      const prepared = prepareMarkdown(source, title);
      const buffers = new Map<string, ArrayBuffer>();
      const previewReplacements = new Map<string, string>();
      const imageErrors: string[] = [];
      let totalImageBytes = 0;
      let largeImageCount = 0;
      for (const image of prepared.images) {
        const target = this.app.metadataCache.getFirstLinkpathDest(image.originalPath, file.path);
        if (!target) { imageErrors.push(`找不到：${image.originalPath}`); continue; }
        try {
          const buffer = await this.app.vault.readBinary(target);
          totalImageBytes += buffer.byteLength;
          if (buffer.byteLength > MAX_STATIC_IMAGE_BYTES && extname(target.path).toLowerCase() !== ".gif") largeImageCount += 1;
          buffers.set(image.placeholder, buffer);
          previewReplacements.set(image.placeholder, toDataUrl(buffer, mimeFor(target.path)));
        } catch {
          imageErrors.push(`无法读取：${image.originalPath}`);
        }
      }
      if (imageErrors.length) throw new Error(`图片检查失败（${imageErrors.length}）：${imageErrors.join("；")}`);
      const html = sanitizeHtml(await renderWechatHtml(
        replaceImagePlaceholders(prepared.markdown, previewReplacements), title, this.plugin.settings,
      )).documentHtml;
      this.article = { file, source, title, prepared, buffers, html, totalImageBytes, largeImageCount };
      this.frame.srcdoc = html;
      const size = totalImageBytes < 1024 * 1024
        ? `${Math.ceil(totalImageBytes / 1024)} KB`
        : `${(totalImageBytes / 1024 / 1024).toFixed(1)} MB`;
      const large = largeImageCount ? ` · ${largeImageCount} 张将在复制时压缩` : "";
      this.statusEl.setText(`${title} · 图片检查通过：${prepared.images.length} 张 / ${size}${large}`);
    } catch (error) {
      this.article = undefined; this.frame.srcdoc = "";
      const message = error instanceof Error ? error.message : String(error);
      this.statusEl.setText(message); new Notice(message);
    } finally {
      this.busy = false; this.updateButtons();
      if (this.reloadRequested) {
        this.reloadRequested = false;
        void this.refresh();
      }
    }
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
      const rendered = await renderWechatHtml(
        replaceImagePlaceholders(this.article.prepared.markdown, replacements), this.article.title, this.plugin.settings,
      );
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

class DouPublishSettingTab extends PluginSettingTab {
  constructor(private readonly pluginInstance: DouPublishPlugin) { super(pluginInstance.app, pluginInstance); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: "group",
      heading: "公众号排版",
      items: [
        { name: "主题色", desc: "用于标题、强调和装饰元素。", control: { type: "color", key: "primaryColor", defaultValue: DEFAULT_WECHAT_STYLE_SETTINGS.primaryColor } },
        { name: "正文字号", control: { type: "slider", key: "fontSize", min: 14, max: 20, step: 1, displayFormat: value => `${value}px` } },
        { name: "行高", control: { type: "slider", key: "lineHeight", min: 1.4, max: 2.2, step: 0.05 } },
        { name: "段落间距", control: { type: "slider", key: "paragraphSpacing", min: 0, max: 32, step: 2, displayFormat: value => `${value}px` } },
        { name: "引用块样式", control: { type: "dropdown", key: "blockquoteStyle", options: { neutral: "中性灰", accent: "主题色" } } },
        { name: "代码块行号", control: { type: "toggle", key: "showLineNumbers" } },
        { name: "图片圆角", control: { type: "slider", key: "imageRadius", min: 0, max: 24, step: 2, displayFormat: value => `${value}px` } },
        { name: "恢复默认排版", desc: "恢复默认样式并刷新当前预览。", action: () => void this.pluginInstance.resetSettings() },
      ],
    }];
  }

  getControlValue(key: string): unknown { return this.pluginInstance.settings[key as keyof WechatStyleSettings]; }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!(key in DEFAULT_WECHAT_STYLE_SETTINGS)) return;
    await this.pluginInstance.updateSetting(key as keyof WechatStyleSettings, value as never);
  }

  // Fallback for Obsidian versions before the declarative settings API.
  display(): void {
    const plugin = this.pluginInstance;
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("公众号排版").setHeading();
    containerEl.createEl("p", { text: "这些设置同时作用于侧栏预览和复制到公众号的内容。" });

    new Setting(containerEl).setName("主题色").setDesc("用于标题、强调和装饰元素。")
      .addColorPicker(component => component.setValue(plugin.settings.primaryColor).onChange(value => plugin.updateSetting("primaryColor", value)));
    new Setting(containerEl).setName("正文字号").setDesc(`${plugin.settings.fontSize}px`)
      .addSlider(component => component.setLimits(14, 20, 1).setValue(plugin.settings.fontSize)
        .onChange(value => plugin.updateSetting("fontSize", value)));
    new Setting(containerEl).setName("行高").setDesc(`${plugin.settings.lineHeight}`)
      .addSlider(component => component.setLimits(1.4, 2.2, 0.05).setValue(plugin.settings.lineHeight)
        .onChange(value => plugin.updateSetting("lineHeight", value)));
    new Setting(containerEl).setName("段落间距").setDesc(`${plugin.settings.paragraphSpacing}px`)
      .addSlider(component => component.setLimits(0, 32, 2).setValue(plugin.settings.paragraphSpacing)
        .onChange(value => plugin.updateSetting("paragraphSpacing", value)));
    new Setting(containerEl).setName("引用块样式")
      .addDropdown(component => component.addOption("neutral", "中性灰").addOption("accent", "主题色")
        .setValue(plugin.settings.blockquoteStyle).onChange(value => plugin.updateSetting("blockquoteStyle", value as WechatStyleSettings["blockquoteStyle"])));
    new Setting(containerEl).setName("代码块行号")
      .addToggle(component => component.setValue(plugin.settings.showLineNumbers)
        .onChange(value => plugin.updateSetting("showLineNumbers", value)));
    new Setting(containerEl).setName("图片圆角").setDesc(`${plugin.settings.imageRadius}px`)
      .addSlider(component => component.setLimits(0, 24, 2).setValue(plugin.settings.imageRadius)
        .onChange(value => plugin.updateSetting("imageRadius", value)));
    new Setting(containerEl).setName("恢复默认排版").setDesc("恢复默认样式并刷新当前预览。")
      .addButton(component => component.setButtonText("恢复默认").onClick(async () => {
        await plugin.resetSettings();
        this.display();
      }));
  }
}

export default class DouPublishPlugin extends Plugin {
  settings: WechatStyleSettings = { ...DEFAULT_WECHAT_STYLE_SETTINGS };

  async onload() {
    this.settings = { ...DEFAULT_WECHAT_STYLE_SETTINGS, ...(await this.loadData() as Partial<WechatStyleSettings> | null) };
    this.registerView(VIEW_TYPE, leaf => new PreviewView(leaf, this));
    this.addRibbonIcon("newspaper", "预览当前文章（公众号）", () => void this.openPreview());
    this.addCommand({ id: "preview-current-article", name: "预览当前文章", callback: () => void this.openPreview() });
    this.addSettingTab(new DouPublishSettingTab(this));
  }

  async updateSetting<K extends keyof WechatStyleSettings>(key: K, value: WechatStyleSettings[K]): Promise<void> {
    this.settings[key] = value;
    await this.saveData(this.settings);
    await this.refreshPreviews();
  }

  async resetSettings(): Promise<void> {
    this.settings = { ...DEFAULT_WECHAT_STYLE_SETTINGS };
    await this.saveData(this.settings);
    await this.refreshPreviews();
  }

  async refreshPreviews(): Promise<void> {
    await Promise.all(this.app.workspace.getLeavesOfType(VIEW_TYPE).map(async leaf => {
      const view = leaf.view as PreviewView;
      await view.refresh();
    }));
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
