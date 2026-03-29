# 携程机票助手项目 - 交接文档 (HANDOVER)

## 一、项目背景
当前项目为 OpenClaw 框架开发的一款 **“携程机票助手” (Ctrip Flight Assistant) Skill**。
- **目标**：赋予 Agent 全自动、可靠地操作携带反爬保护的商用网站（携程 www.ctrip.com），并能以对话形式完成扫码登录、搜索筛选及航班抓取的全链路自动化。
- **运行环境**：基于 OpenClaw 提供的 Docker Agent 环境。浏览器由 `openclaw-browser` 提供（通过 `ws://openclaw-browser:9222` 连接），Agent 端只允许通过 `node script.js` 发起 bash 命令。

## 二、当前已解决的重大底层架构难题

在先前的开发过程中，我们踩平了 Puppeteer/Browserless 架构在云原生环境下的三个致命大山：

1. **HttpOnly 和跨域单点登录 (SSO) 隐形拦截**：
   - 携程的登录在 `passport.ctrip.com` 完成后，票据 `Ticket` 会写入顶级域名 `.ctrip.com` 并且被 HttpOnly 保护。
   - **解决方案**：彻底废弃前端层面受到“同源策略”约束的官方 `page.cookies()`，重构为直接向 Chromium 引擎发送底层的拦截指令 `Network.getAllCookies`，精准拔出全局验证票据。

2. **上下文销毁导致 Node 死锁报错** (`Execution context was destroyed`)：
   - 扫码成功后网页发生自然跳转，如果此时使用 `page.evaluate` 去获取 DOM 会直接崩溃死锁。
   - **解决方案**：加入高容错的 Try-Catch 以及利用 `page.url()` 变动被动监听原生重定向。

3. **【核心坑点】容器化沙盒“阅后即焚”的生命周期断层**：
   - Agent 执行 bash 命令获取二维码时，由于 `login.js --qrcode` 生成图片后必须退出进程以返回控制权给 Agent（否则超时死锁）。
   - 但是 OpenClaw 浏览器底层相当于 Browserless，**只要 Node 脚本一断开连接，浏览器底层会瞬间销毁包含在内的所有上下文和当前标签页**。导致用户手机扫完二维码，发现连接的目标 PC 网页已经被删了，验证结果根本无处存放并返回。
   - **终局解决方案（后台守护者架构）**：
     目前的最新代码在 `login.js --qrcode` 被调用时不再亲力亲为，而是利用子进程（`child_process.spawn`）生成了一个**独立于宿主进程的高级别守护程序 (`qr-daemon.js`)**。
     - 守护进程后台常驻运行，死死咬住 Chromium 上下文，确保 QR 码的标签页不会在 Agent 等待期间被焚毁。
     - 在守护进程里它会默默等待最多 3 分钟的扫码确认，一旦跳转，自动抓取 `Network.getAllCookies` 并保存。而执行的主 Node 将图片地址返回给 Agent 让其发送给用户。两边形成完美闭环。

## 三、当前进展与测试边界
当前版本已通过 `./deploy_and_reset.sh` 全新部署到了容器中，并将之前的测试冗余文件都从 GitHub 清理干净了。现在正处在一个“待验收”的黄金起点。

## 四、下一阶段（新对话）需要处理的核心任务

1. **终端联调验收测试**：
   - **你的任务**：在新对话中，在微信里让 Agent 去查询机票。
   - 观察它是否能够使用重构后的守护进程（Daemon）正确提取你的扫描事件。

2. **航班参数查询守门人逻辑**：
   - 根据在 `SKILL.md` 里订立的规则，Agent 在开始 `search-flights.js` 之前**必须集齐 5 个特殊参数**（包括起飞时间、机场选择、舱位、是否偏好大飞机等）。
   - **你的任务**：测试这部分对话是否过关，如果不符合要求，在新对话里看日志对 Prompt 进行修正。

3. **搜索脚本的健壮性 (`search-flights.js`)**：
   - 若验证通过并拿到 Cookie 后，查询页面如果改变了它的 CSS Selector 结构，有抓取失败的可能。我们需要保障最终出来的 Json Array 没有任何遗漏。

**提示 Agent 恢复记忆小技巧**：在新窗口中 `@` 你提到的相关仓库名或在首条信息中附上本文件的阅读指令：
`“请阅读 ctrip_flight_v1/HANDOVER.md，以恢复当前机票技能的开发背景记忆。”`
