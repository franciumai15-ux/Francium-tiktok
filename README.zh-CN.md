[English](README.md)

# TikTok Search API

一个 Node.js 脚本，用于搜索 TikTok 并输出结构化 JSON：结果卡片（视频/图片）、推荐用户、搜索标签页和页面上下文。在你自己的电脑、服务器或手机上运行。基本运行不需要账号、API 密钥，也不需要安装。

## 环境要求

- Node.js 18 或更高版本（推荐 20+）。用 `node --version` 检查。
- 基本运行不需要其他东西：零依赖，不用 `npm install`。

## 快速开始

```sh
git clone https://github.com/FAK-LABS/tiktok-search-api.git
cd tiktok-search-api
node tiktok-search.mjs "FAK LABS"
```

不想下载整个仓库？只拿单个文件：

```sh
curl -O https://raw.githubusercontent.com/FAK-LABS/tiktok-search-api/main/tiktok-search.mjs
node tiktok-search.mjs "FAK LABS"
```

## 用法

```sh
node tiktok-search.mjs "search terms" [options]
```

| 选项 | 作用 |
|---|---|
| `--cookie "name=value; ..."` | 已登录的 TikTok Cookie（或设置 `TIKTOK_COOKIE`） |
| `--tab top` \| `video` | 搜索标签页（默认：`video`） |
| `--scroll N` | 浏览器模式下的滚动轮数，0-10（默认：5） |
| `--raw` | 在 `context` 中包含完整的 rehydration JSON |
| `--debug` | 包含一个 debug 对象（最终 URL、标题、数量） |
| `--browser` | 在真实浏览器中渲染页面（需要 `puppeteer`） |
| `--html <file>` | 解析已保存的 TikTok 搜索页面，不发起请求 |
| `-h`, `--help` | 显示帮助 |

示例：

```sh
node tiktok-search.mjs "FAK LABS"
node tiktok-search.mjs "funny cats" --tab top
node tiktok-search.mjs "FAK LABS" --cookie "sessionid=abc123; sid_tt=xyz"
node tiktok-search.mjs "FAK LABS" --browser --scroll 3
node tiktok-search.mjs --html saved-search-page.html "FAK LABS"
TIKTOK_COOKIE="sessionid=abc123; sid_tt=xyz" node tiktok-search.mjs "FAK LABS"
```

把输出保存到文件：

```sh
node tiktok-search.mjs "FAK LABS" > results.json
```

## 输出

输出到 stdout 的 JSON。示例（已精简，只展示一项）：

```json
{
  "success": true,
  "source": "direct-fetch",
  "query": "FAK LABS",
  "totalItems": 3,
  "totalFeaturedUsers": 2,
  "tab": "video",
  "tabs": ["Top", "Videos", "Users"],
  "items": [
    {
      "index": 0,
      "id": "7461234567890123456",
      "type": "video",
      "url": "https://www.tiktok.com/@faklabs/video/7461234567890123456",
      "authorHandle": "faklabs",
      "authorName": "FAK LABS",
      "caption": "FAK BOT by FAK LABS #faklabs",
      "hashtags": ["faklabs"],
      "sound": "original sound - faklabs",
      "thumbnail": "https://p16-sign.tiktokcdn.com/thumb.jpg",
      "likesOrViewsText": "12.3K",
      "likesOrViewsCount": 12300,
      "isTopLiked": true
    }
  ],
  "featuredUsers": [
    {
      "handle": "featured_one",
      "profileUrl": "https://www.tiktok.com/@featured_one",
      "posts": []
    }
  ],
  "context": { "language": "en", "region": "US" }
}
```

`source` 的值是 `direct-fetch`、`browser-rendering` 或 `file-html`。
失败时，脚本向 stderr 输出 `{"success": false, "error": "..."}`，并以退出码 1 退出。

## 获取 TIKTOK_COOKIE（为了更可靠的结果）

1. 在桌面浏览器中登录 tiktok.com。
2. 打开开发者工具（F12）→ Application → Cookies → `https://www.tiktok.com`。
3. 把 Cookie 复制为一个字符串：`name=value; name=value; ...`
4. 使用：

```sh
node tiktok-search.mjs "FAK LABS" --cookie "sessionid=...; sid_tt=..."
```

或者每个会话设置一次：

```sh
export TIKTOK_COOKIE="sessionid=...; sid_tt=..."
node tiktok-search.mjs "FAK LABS"
```

永远不要把你的 Cookie 字符串发给任何人，也不要提交到仓库里。它就是以你的身份登录。

## 为什么结果可能是空的

TikTok 在搜索结果前面加了机器人检测。自动请求，尤其是来自数据中心 IP（大多数 VPS 服务器）的请求，经常会拿到空白页面，即使未登录的真实浏览器也能拿到结果。出现这种情况时，脚本仍然以退出码 0 退出，并输出合法的 JSON，其中 `"totalItems": 0`，还有一个 `warning` 字段说明原因。

真正有用的办法，按顺序：

1. 一个已登录的 `TIKTOK_COOKIE`（见上文）。
2. 住宅 IP，而不是数据中心 IP。
3. `--browser` 模式，在真实浏览器中渲染页面。
4. `--html`：在能看到结果的真实浏览器中打开 `tiktok.com/search?q=...`，保存页面（Ctrl+S，完整页面），然后解析它：

```sh
node tiktok-search.mjs --html saved-page.html "FAK LABS"
```

## 在你自己的 VPS 上运行

任何 Ubuntu/Debian VPS 都可以。SSH 登录后运行：

```sh
sudo apt update && sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/FAK-LABS/tiktok-search-api.git
cd tiktok-search-api
node tiktok-search.mjs "FAK LABS"
```

用 cron 定时运行搜索（每小时保存一次 JSON）：

```sh
crontab -e
```

```cron
0 * * * * cd ~/tiktok-search-api && node tiktok-search.mjs "FAK LABS" > ~/fak-labs.json 2> ~/fak-labs.err
```

注意：大多数 VPS IP 都是数据中心 IP，所以没有登录 Cookie 的话请预期结果为空——见上文“为什么结果可能是空的”。

## 安装 Node.js

### Ubuntu / Debian

```sh
sudo apt update && sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

然后：

```sh
git clone https://github.com/FAK-LABS/tiktok-search-api.git
cd tiktok-search-api
node tiktok-search.mjs "FAK LABS"
```

### Linux（其他发行版）

```sh
# Fedora / RHEL
sudo dnf install -y nodejs git

# Arch
sudo pacman -S nodejs git
```

或者从 https://nodejs.org 下载 Node.js，然后按上面的方式克隆并运行脚本。

### Termux (Android)

```sh
pkg update && pkg install -y nodejs git
git clone https://github.com/FAK-LABS/tiktok-search-api.git
cd tiktok-search-api
node tiktok-search.mjs "FAK LABS"
```

要把输出保存到其他应用能看到的地方，先给 Termux 存储权限（`termux-setup-storage`），然后写入 `~/storage/downloads`：

```sh
node tiktok-search.mjs "FAK LABS" > ~/storage/downloads/results.json
```

### Windows (PowerShell)

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

关闭 PowerShell，重新打开，然后：

```powershell
git clone https://github.com/FAK-LABS/tiktok-search-api.git
cd tiktok-search-api
node tiktok-search.mjs "FAK LABS"
```

没有 git？从 GitHub 下载仓库的 ZIP，解压后在 PowerShell 中进入该文件夹运行脚本。

## 工作原理

1. 用桌面浏览器 User-Agent 请求 TikTok 搜索页面（普通的 `fetch`，传入 Cookie 时会带上它）。
2. 解析结果卡片（`data-e2e="search_video-item"` / `search_top-item`、`user-post-item`、`#search-tabs`）以及用于页面上下文的 `__UNIVERSAL_DATA_FOR_REHYDRATION__` 脚本。
3. 把结果以 JSON 输出。

`--browser` 在真实的无头浏览器中打开同一页面，让客户端结果加载完成后再解析渲染后的页面。它需要 `puppeteer`，这是唯一的可选依赖：

```sh
npm install puppeteer
```

## 文件

- `tiktok-search.mjs` — 整个脚本，零依赖
- `package.json` — `--browser` 模式的可选 `puppeteer`，以及 `tiktok-search` 命令（`npm install -g .` 后全局可用）
- `README.zh-CN.md` — 本文件
