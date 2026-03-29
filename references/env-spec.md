# 环境要求声明

## 1. 浏览器环境
- CDP Endpoint: `ws://openclaw-browser:9222`
- 浏览器类型: HeadlessChrome/121.0.6167.57 (browserless/chrome)
- 浏览器容器配置: stealth=true, block-ads=true
- **绝对不能调用 `browser.close()` 或 `page.close()`**

## 2. Node.js 环境
- 版本: v24.14.0
- 已安装包:
  - `puppeteer-core` (用于浏览器控制)

## 3. 文件路径约定
| 用途 | 路径 |
|------|------|
| Cookie 保存 | `/home/node/.openclaw/workspace/ctrip_cookies.json` |
| 登录状态 | `/home/node/.openclaw/workspace/.auth/ctrip_auth.json` |
| 临时截图 | `/tmp/` 目录 |

## 4. 日期计算要求
- 时区: Asia/Shanghai (北京时间)
- 格式: YYYY-MM-DD

## 5. 关键限制
- 容器内无浏览器二进制文件，必须通过 CDP 连接
- 无法使用 `page.waitForTimeout()`，改用 `new Promise(r => setTimeout(r, ms))`
- Cookie 跨域设置可能失败，需要 try-catch 忽略
