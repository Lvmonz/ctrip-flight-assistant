# 携程机票助手 🛫

OpenClaw Skill — 通过浏览器自动化操控携程，实现账号登录和航班搜索。

## 功能

| 工具 | 说明 | 命令 |
|------|------|------|
| 登录 | Cookie 恢复 / 扫码 / 手机号 | `node scripts/login.js` |
| 搜索 | 国内航班查询 + 结果解析 | `node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-04-05` |

## 安装

### 方式一：本地安装（OpenClaw 直接安装在系统上）

```bash
# 1. 找到你的 OpenClaw skills 目录
#    通常在 ~/.openclaw/skills/ 或你自定义的路径

# 2. 克隆到 skills 目录
cd ~/.openclaw/skills
git clone https://github.com/Lvmonz/ctrip-flight-assistant.git ctrip-flight

# 3. 安装依赖
cd ctrip-flight
npm install

# 4. 重启 OpenClaw 使其加载新 skill
openclaw restart
```

### 方式二：Docker 安装（OpenClaw 运行在 Docker 容器内）

```bash
# 1. 找到你的 OpenClaw 配置目录（docker-compose.yml 所在目录）
cd ~/openclaw-oneclick  # 或你的实际路径

# 2. 克隆到 config/skills 目录（该目录会被挂载到容器内）
git clone https://github.com/Lvmonz/ctrip-flight-assistant.git config/skills/ctrip-flight

# 3. 进入容器安装依赖
docker compose exec openclaw-core bash -c "cd /home/node/.openclaw/skills/ctrip-flight && npm install"

# 4. 重启容器
docker compose restart openclaw-core
```

> **⚠️ Docker 用户注意：** 需要确保浏览器 sidecar 容器已启动（`docker-compose.browser.yml`），且 `CHROME_CDP_URL` 环境变量已配置。参考 [环境要求](#环境要求)。

### 方式三：手动复制

如果你不使用 git，也可以直接下载 ZIP 并解压到 skills 目录：

| 安装类型 | 目标路径 |
|----------|----------|
| 本地安装 | `~/.openclaw/skills/ctrip-flight/` |
| Docker | `<你的openclaw目录>/config/skills/ctrip-flight/` |

## 环境要求

本 skill 需要浏览器环境来操作携程网站：

| 项目 | 说明 |
|------|------|
| 浏览器 | 需通过 CDP (Chrome DevTools Protocol) 连接 |
| CDP 地址 | 本地: `ws://localhost:9222` / Docker: `ws://openclaw-browser:9222` |
| Node.js | v20+ |
| 依赖 | `puppeteer-core` (npm install 自动安装) |

### Docker 用户的浏览器配置

确保 `docker-compose.browser.yml` 中包含浏览器 sidecar：

```yaml
services:
  openclaw-browser:
    image: browserless/chrome:latest
    container_name: openclaw-browser
    environment:
      - PORT=9222
      - DEFAULT_STEALTH=true
      - DEFAULT_BLOCK_ADS=true
    ports:
      - "9222:9222"
```

并在 `.env` 中设置：
```
CHROME_CDP_URL=ws://openclaw-browser:9222
```

### 本地用户的浏览器配置

启动 Chrome，开启远程调试端口：
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

## 目录结构

```
ctrip-flight/
├── SKILL.md              # Agent 指令（触发条件 + 工作流）
├── package.json
├── scripts/
│   ├── browser-utils.js   # CDP 连接、Cookie 管理、截图
│   ├── login.js           # 登录（Cookie恢复/扫码/手机号）
│   └── search-flights.js  # 航班搜索 + 解析
└── references/
    └── env-spec.md        # 环境约束文档
```

## 关键约束

在 skill 脚本中必须遵守：
- ❌ **不能** 调用 `browser.close()` 或 `page.close()` — 浏览器是共享实例
- ❌ **不能** 使用 `page.waitForTimeout()` — 用 `new Promise(r => setTimeout(r, ms))` 替代
- ✅ Cookie 跨域设置需逐条 try-catch 处理

## License

MIT
