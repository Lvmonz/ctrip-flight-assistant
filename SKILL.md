---
name: ctrip-flight
description: 携程机票助手 — 登录携程账号、搜索航班信息。当用户提到携程、机票、航班、订票、买票时触发。
---

# 携程机票助手

通过浏览器自动化操作携程网站，完成账号登录和航班搜索。

## 前置条件

- 浏览器已通过 CDP 连接 (`ws://openclaw-browser:9222`)
- 已安装 `puppeteer-core`

## 关键约束

> ⚠️ **必须严格遵守以下规则，违反会导致浏览器崩溃或容器异常！**

1. **绝对不能**调用 `browser.close()` 或 `page.close()` — 浏览器是共享的
2. **不能**使用 `page.waitForTimeout()` — 用 `new Promise(r => setTimeout(r, ms))` 替代
3. Cookie 跨域设置可能失败，必须用 try-catch 逐条处理
4. 截图保存到 `/tmp/` 目录

## 工作流程

### 流程一: 登录携程

**触发**: 用户要求登录携程、查机票前需要先登录

**步骤**:

1. 运行 `cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js --check` 检查是否已登录
2. 如果已登录 → 告知用户当前登录状态
3. 如果未登录 → 运行 `cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js`
   - 脚本会先尝试恢复 Cookie
   - 恢复失败则打开扫码登录页，截图二维码
4. 【极其重要】脚本获取到二维码后会**立刻退出并返回路径**。你必须**立刻用 notify_user 等工具把二维码发给用户**，请他们扫码！
5. 停下来等待用户回复（比如"扫好了"或"完成"）。
6. 收到用户确认后，你必须执行 `cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js --check` 检查登录结果，成功后 Cookie 会自动持久化！

**命令参考**:
```bash
# 自动模式（先恢复 Cookie，失败则扫码）
cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js

# 仅检查登录状态
cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js --check

# 强制扫码登录
cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js --qrcode

# 手机号登录
cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js --phone 13800138000
```

### 流程二: 搜索航班

**触发**: 用户要查机票、搜航班、问价格

**步骤**:

1. 从用户消息中提取: 出发城市、到达城市、出发日期
2. 如果信息不完整，向用户确认
3. 运行搜索脚本:
   ```bash
   cd /home/node/.openclaw/skills/ctrip-flight && node scripts/search-flights.js --from 出发城市 --to 到达城市 --date YYYY-MM-DD
   ```
4. 解析输出 JSON，将航班信息格式化后回复用户
5. 如果用户要求仅看直飞，加 `--direct` 参数

**命令参考**:
```bash
# 基础搜索
cd /home/node/.openclaw/skills/ctrip-flight && node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-04-05

# 仅直飞
cd /home/node/.openclaw/skills/ctrip-flight && node scripts/search-flights.js --from HGH --to PEK --date 2026-04-05 --direct

# 支持三字码或中文城市名
```

**日期计算**: 时区为 Asia/Shanghai (北京时间)，格式 YYYY-MM-DD

**支持的城市**: 北京/上海/广州/深圳/杭州/成都/重庆/武汉/西安/南京/天津/青岛/大连/厦门/长沙/昆明/三亚/海口/贵阳/郑州/哈尔滨/沈阳/拉萨/乌鲁木齐/香港/台北/澳门 及所有 IATA 三字码

### 结果展示规范

航班搜索结果应以**表格**或**列表**形式展示，每条航班包含:
- 航班号 + 航司
- 出发/到达时间
- 出发/到达机场
- 价格
- 经停/直飞
- 准点率（如有）

示例输出格式:
```
✈️ 杭州 → 北京 2026-04-05 航班搜索结果

1. CA1702 国航 | 07:30-09:50 | 萧山T4→首都T3 | ¥680 经济舱 | 直飞 | 准点率92%
2. MU5131 东航 | 08:15-10:40 | 萧山T4→大兴 | ¥620 经济舱 | 直飞 | 准点率88%
3. HU7182 海航 | 10:00-12:25 | 萧山T4→首都T1 | ¥550 经济舱 | 直飞 | 准点率85%
```

## 错误处理

| 情况 | 处理 |
|------|------|
| CDP 连接失败 | 提示用户检查浏览器容器是否运行 |
| 携程页面加载超时 | 等待 5 秒后重试一次 |
| 用户反馈二维码过期或失效 | 重新运行 `cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js --qrcode` 获取新二维码 |
| 登录验证失败 | 确认用户是否扫码成功，或建议换手机号登录 (`--phone`) |
| 搜索无结果 | 建议用户换日期或放宽条件 |
| 结构化解析失败 | 脚本返回原始文本，你自己解析 |

## 文件路径

| 文件 | 路径 |
|------|------|
| Cookie | `/home/node/.openclaw/workspace/ctrip_cookies.json` |
| Auth 状态 | `/home/node/.openclaw/workspace/.auth/ctrip_auth.json` |
| 截图 | `/tmp/ctrip_*.png` |
