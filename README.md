# 携程机票助手 🛫

OpenClaw Skill — 通过浏览器自动化操控携程，实现登录和航班搜索。

## 功能

| 工具 | 说明 | 命令 |
|------|------|------|
| 登录 | Cookie 恢复 / 扫码 / 手机号 | `node scripts/login.js` |
| 搜索 | 国内航班查询 + 结果解析 | `node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-04-05` |

## 安装到 OpenClaw

```bash
# 方式 1: 从 GitHub 安装
openclaw skills install github:jackchi/ctrip-flight-assistant

# 方式 2: 本地安装
# 将此目录复制到 OpenClaw 的 skills 目录
cp -r . /path/to/openclaw/config/skills/ctrip-flight/
```

## 目录结构

```
ctrip-flight/
├── SKILL.md              # Agent 指令（触发条件 + 工作流）
├── package.json           # 依赖声明
├── scripts/
│   ├── browser-utils.js   # CDP 连接、Cookie 管理、截图
│   ├── login.js           # 登录（Cookie恢复/扫码/手机号）
│   └── search-flights.js  # 航班搜索 + 解析
└── references/
    └── env-spec.md        # 环境约束文档
```

## 环境要求

- OpenClaw + 浏览器 sidecar（browserless/chrome）
- CDP Endpoint: `ws://openclaw-browser:9222`
- Node.js v20+ + puppeteer-core

## License

MIT
