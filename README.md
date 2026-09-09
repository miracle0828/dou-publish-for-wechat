# Dou Publish for WeChat

An Obsidian desktop plugin that previews Markdown using a WeChat-friendly theme and copies rich text, including hosted article images, into the WeChat Official Account editor. Open a Markdown note, preview it from the ribbon, configure your own WeChat App ID and app secret when local images need uploading, then choose **Copy to WeChat** and paste into the editor.

The preview stays local. The plugin sends local article images only to the official `api.weixin.qq.com` endpoint after the user explicitly chooses to copy. Credentials remain in the current vault's plugin data file.

一款桌面端 Obsidian 插件，用统一的公众号样式预览 Markdown，并把带格式正文和本地配图一键复制到微信公众号编辑器。

## 功能

- 在 Obsidian 侧栏预览公众号排版
- 支持 Markdown 图片与 Obsidian 图片嵌入 `![[image.png]]`
- 一键复制行内样式和正文图片，粘贴到微信公众号编辑器
- 自动把较大的静态图片压缩为适合微信正文的 JPEG
- 按图片内容缓存微信地址，重复复制无需再次上传
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
3. 纯文字文章可直接点击“复制到公众号”。
4. 正文含本地图片时，先在插件设置中填写自己的公众号 AppID 与 AppSecret，并在微信公众平台配置调用 IP 白名单。
5. 点击“复制到公众号”，到公众号正文编辑区按 `Ctrl+V`。标题与封面仍在公众号后台单独填写。

外链图片不会被插件自动下载，请先保存到 Obsidian 仓库。GIF 超过 1 MB 时需要先手动压缩。

## 隐私与安全

- 预览在本机完成，不上传正文。
- 只有用户点击“复制到公众号”时，正文内的本地图片才会发送到微信官方接口 `api.weixin.qq.com`。
- AppID、AppSecret 与图片缓存保存在当前仓库的 `.obsidian/plugins/dou-publish-preview/data.json`。不要把这个文件提交到公开仓库或发给其他人。
- 插件不会把凭据或文章发送到开发者服务器。
- 预览使用受限 iframe；复制前会移除脚本、嵌入对象、事件属性和不安全链接。

## 开发

需要 Node.js 18 或更高版本。

```bash
npm install
npm test
npm run build
npm run package
```

排版引擎使用开源包 `baoyu-md`。插件参考了 WeSight“先上传图片，再复制富文本”的工作顺序，未复制其源码。
