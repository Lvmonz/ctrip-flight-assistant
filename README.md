# 携程机票助手 🛫

OpenClaw Skill — 通过浏览器自动化操控携程，实现账号登录和航班搜索。

## 功能

| 工具 | 说明 | 命令 |
|------|------|------|
| 登录 | Cookie 恢复 / 扫码 / 手机号 | `node scripts/login.js` |
| 搜索 | 国内航班查询 + 结果解析 | `node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-04-05` |

## 安装

### 方式一：本地安装（OpenClaw 直接运行在系统上）

```bash
# 1. 找到你的 OpenClaw 数据目录（默认 ~/.openclaw）
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"

# 2. 克隆到 skills 目录
git clone https://github.com/Lvmonz/ctrip-flight-assistant.git "$OPENCLAW_HOME/skills/ctrip-flight"

# 3. 安装依赖
cd "$OPENCLAW_HOME/skills/ctrip-flight"
npm install

# 4. 重启 OpenClaw
openclaw restart
```

### 方式二：Docker 安装

Docker 部署的 OpenClaw 使用 named volume，技能需要复制到容器内部。

```bash
# 1. 克隆仓库到本地临时目录
git clone https://github.com/Lvmonz/ctrip-flight-assistant.git /tmp/ctrip-flight
cd /tmp/ctrip-flight && npm install

# 2. 找到你的 OpenClaw 容器名（替换为你的实际容器名）
#    查看容器名: docker ps --format '{{.Names}}' | grep -i openclaw
CONTAINER_NAME=$(docker ps --format '{{.Names}}' | grep -i 'openclaw' | grep -iv 'browser' | head -1)
echo "检测到 OpenClaw 容器: $CONTAINER_NAME"

# 3. 找到容器内的 skills 目录
SKILLS_DIR=$(docker exec "$CONTAINER_NAME" find /home -name "skills" -path "*/.openclaw/*" -type d 2>/dev/null | head -1)
echo "Skills 目录: $SKILLS_DIR"

# 4. 复制到容器
docker cp /tmp/ctrip-flight/. "$CONTAINER_NAME:$SKILLS_DIR/ctrip-flight/"

# 5. 验证
docker exec "$CONTAINER_NAME" ls "$SKILLS_DIR/ctrip-flight/SKILL.md" && echo "✅ 安装成功"

# 6. 重启容器加载新 skill
docker restart "$CONTAINER_NAME"

# 7. 清理临时文件
rm -rf /tmp/ctrip-flight
```

<details>
<summary>如果自动检测失败，手动指定容器和路径</summary>

```bash
# 手动设置容器名和 skills 路径
CONTAINER_NAME="openclaw-main"               # 你的实际容器名
SKILLS_DIR="/home/node/.openclaw/skills"     # 容器内 skills 路径

# 复制并重启
docker cp /tmp/ctrip-flight/. "$CONTAINER_NAME:$SKILLS_DIR/ctrip-flight/"
docker restart "$CONTAINER_NAME"
```

</details>

### 方式三：手动下载

从 [Releases](https://github.com/Lvmonz/ctrip-flight-assistant/archive/refs/heads/main.zip) 下载 ZIP，解压后放入对应目录：

| 安装类型 | 目标路径 |
|----------|----------|
| 本地 | `~/.openclaw/skills/ctrip-flight/` |
| Docker | 用 `docker cp` 复制到容器内 `skills/ctrip-flight/` |

## 环境要求

本 skill 需要浏览器环境来操作携程网站：

| 项目 | 说明 |
|------|------|
| 浏览器 | 通过 CDP (Chrome DevTools Protocol) 连接 |
| CDP 地址 | 本地: `ws://localhost:9222` / Docker: `ws://openclaw-browser:9222` |
| Node.js | v20+ |
| 依赖 | `puppeteer-core`（npm install 自动安装） |

### Docker 用户的浏览器配置

确保有浏览器 sidecar 容器（如 `browserless/chrome`），并在 `.env` 中配置：
```
CHROME_CDP_URL=ws://openclaw-browser:9222
```

### 本地用户的浏览器配置

启动 Chrome 并开启远程调试：
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

## 目录结构

```
ctrip-flight/
├── SKILL.md               # Agent 指令（触发条件 + 工作流）
├── package.json
├── scripts/
│   ├── browser-utils.js   # CDP 连接、Cookie 管理、截图
│   ├── login.js           # 登录（Cookie恢复/扫码/手机号）
│   └── search-flights.js  # 航班搜索 + 解析
└── references/
    └── env-spec.md        # 环境约束文档
```

## License

MIT
