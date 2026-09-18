# Dou Publish for WeChat

An Obsidian desktop plugin that previews Markdown using a WeChat-friendly theme and copies rich text, including local article images, into the WeChat Official Account editor. Open a Markdown note, preview it from the ribbon, choose **Copy to WeChat**, and paste into the editor. No WeChat API credentials are required for copying.

Previewing and copying stay local. Local images are embedded into the rich-text clipboard and are not uploaded by the plugin.

一款桌面端 Obsidian 插件，用统一的公众号样式预览 Markdown，并把带格式正文和本地配图一键复制到微信公众号编辑器。

## 功能

- 在 Obsidian 侧栏预览公众号排版
- 支持 Markdown 图片与 Obsidian 图片嵌入 `![[image.png]]`
- 一键复制行内样式和正文图片，粘贴到微信公众号编辑器
- 自动把较大的静态图片压缩为适合公众号粘贴的 JPEG
- 无需公众号 AppID、AppSecret 或 IP 白名单
- 不创建草稿，不自动发布文章

## 安装

### 使用 Release 安装

下载 Release 中的 ZIP，解压到仓库的 `.obsidian/plugins/dou-publish-preview/`。目录内至少应有：

```text
main.js
manifest.json
styles.css
```

重启 Obsidian，在“设置 → 第三方插件”中启用 **Dou Publish for WeChat**。

### 使用源码安装

Obsidian 不能直接运行 `src/*.ts`，需要先把源码编译成 `main.js`：

```bash
git clone https://github.com/miracle0828/dou-publish-for-wechat.git dou-publish-preview
cd dou-publish-preview
npm install
npm run build
```

编译完成后有两种安装方式：

1. 如果源码就放在仓库的 `.obsidian/plugins/dou-publish-preview/`，直接重启 Obsidian 并启用插件。
2. 如果源码放在其他目录，把生成的 `main.js`、`manifest.json`、`styles.css` 复制到 `.obsidian/plugins/dou-publish-preview/`，然后重启 Obsidian。

运行源码与构建插件需要 Node.js 18 或更高版本；普通使用者安装 Release 不需要 Node.js。

## 使用

1. 打开 Markdown 文章。
2. 点击左侧报纸图标，检查右侧预览。
3. 点击“复制到公众号”。插件会把本地图片转换为剪贴板图片数据，无需配置公众号接口。
4. 到公众号正文编辑区按 `Ctrl+V`。标题与封面仍在公众号后台单独填写。

外链图片不会被插件自动下载，请先保存到 Obsidian 仓库。GIF 超过 10 MB 时仍可复制，但粘贴可能较慢。

## 隐私与安全

- 预览在本机完成，不上传正文。
- 点击“复制到公众号”时，本地图片会转换为 Base64 图片并写入系统富文本剪贴板。
- 插件不需要公众号凭据，不调用微信 API，也不会把文章或图片发送到开发者服务器。
- 预览使用受限 iframe；复制前会移除脚本、嵌入对象、事件属性和不安全链接。

## 开发

需要 Node.js 18 或更高版本。

```bash
npm install
npm test
npm run build
npm run package
```

排版引擎使用开源包 `baoyu-md`。零配置图片复制流程参考了 Wechat Converter 的“本地图片转 Data URL 后写入富文本剪贴板”方案，未复制其源码。
