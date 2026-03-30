---
name: ctrip-flight
description: 携程机票助手 — 登录携程账号、搜索航班、推荐航班、预订机票。当用户提到携程、机票、航班、订票、买票时触发。
---

# 携程机票助手

通过浏览器自动化操作携程网站，完成账号登录、航班搜索推荐和下单预订。

## 前置条件

- 浏览器已通过 CDP 连接 (`ws://openclaw-browser:9222`)
- 已安装 `puppeteer-core`

## 关键约束

> ⚠️ **必须严格遵守以下规则，违反会导致浏览器崩溃或容器异常！**

1. **绝对不能**调用 `browser.close()` 或 `page.close()` — 浏览器是共享的
2. **不能**使用 `page.waitForTimeout()` — 用 `new Promise(r => setTimeout(r, ms))` 替代
3. Cookie 跨域设置可能失败，必须用 try-catch 逐条处理
4. 截图保存到 `/tmp/` 目录

---

## 流程一: 登录携程

**触发**: 用户要求登录携程、查机票前需要先登录

**步骤**:

1. 绝对强制执行自动登录脚本: `cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js`
   - 脚本内部会自动做全部判定（恢复或返回扫码图片），你**不要做任何自作聪明的判断**，只需要无脑执行这行命令。
2. 如果脚本返回了 `logged_in` → 告知用户已登录成功并等待下一指令。
3. 如果脚本返回了二维码图片 (`waiting_scan`) → 【极其重要】**立即把二维码图片使用 notify_user 发给用户**，请他们扫码！
4. 停下来等待用户回复（比如"扫好了"或"完成"）。
5. 收到用户说扫码完成后，强制执行 `cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js --check` 检查结果。

**命令参考**:
```bash
# 发起/检查登录
cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js

# 用户扫码后验证
cd /home/node/.openclaw/skills/ctrip-flight && node scripts/login.js --check
```

---

## 流程二: 搜索航班

**触发**: 用户要查机票、搜航班、问价格

**步骤**:

0. **【最高优先级】** 任何操作第一步都必须保证已登录！如果不确定，**先执行流程一**。
1. 从用户消息中提取需要的信息。
2. **【致命约束】你必须在一条消息里把下面 7 个参数全部确认/询问！缺任何一个都不准运行搜索脚本！**

   | # | 参数 | 说明 | 默认值 |
   |---|------|------|--------|
   | 1 | **出发城市** | 中文或三字码 | 无默认，必须问 |
   | 2 | **到达城市** | 中文或三字码 | 无默认，必须问 |
   | 3 | **出发日期** | YYYY-MM-DD 格式 | 无默认，必须问 |
   | 4 | **舱位** | 经济舱/商务舱/头等舱 | 经济舱 |
   | 5 | **机场偏好** | 首都/大兴/浦东/虹桥/无所谓 | 无所谓 |
   | 6 | **起飞时间** | 早上/中午/晚上/无所谓 | 无所谓 |
   | 7 | **是否偏好大飞机/宽体机** | 是/否 | 否 |

   > ⚠️ 如果用户在初次消息中已经提供了部分参数，你只需确认还缺的参数。

3. 参数齐全后运行搜索:
   ```bash
   cd /home/node/.openclaw/skills/ctrip-flight && node scripts/search-flights.js \
     --from 出发城市 --to 到达城市 --date YYYY-MM-DD \
     --cabin economy|business|first \
     --direct \
     --time "早上|中午|晚上" \
     --airport "首都|大兴" \
     --sort price
   ```
   > **注意**:
   > - `--direct` 默认总是加上（除非用户说可以接受经停/中转）
   > - `--largeOnly true` 只有在用户说"是"时才加，不要加引号
   > - `--airport` 只填机场简称如"首都""大兴"，**严禁**带 T2/T3 航站楼编号
   > - 如果用户说"无所谓"，则省略对应参数

4. **【防幻觉铁律】**:
   - 🚨 若 `totalFlights: 0`，**必须诚实告知用户没找到**，并询问放宽哪个条件。**绝对禁止**偷偷修改参数重搜然后假装找到了。
   - 🚨 **禁止对机型撒谎**！JSON 中写着 `空客321(中)` 就是中型机，不准说成大飞机。
   - 🚨 推荐航班时，所有信息（航班号、价格、机型、机场）**必须原样引用 JSON 数据**，不准凭记忆编造。

5. 解析 JSON 结果，进入**流程三：航班推荐**。

**额外搜索参数（可选）**:
- `--airline "南方航空"` 按航司过滤
- `--maxPrice 800` 最高价格过滤
- `--sort price|time|duration` 排序方式

**日期计算**: 时区 Asia/Shanghai，格式 YYYY-MM-DD

**支持的城市**: 北京/上海/广州/深圳/杭州/成都/重庆/武汉/西安/南京/天津/青岛/大连/厦门/长沙/昆明/三亚/海口/贵阳/郑州/哈尔滨/沈阳/拉萨/乌鲁木齐/香港/台北/澳门 及所有 IATA 三字码

---

## 流程三: 航班推荐

**触发**: 搜索结果返回后自动执行

**规则**:

搜索脚本返回全量航班后，你必须从结果中**挑选 3 个航班推荐给用户**，并附上推荐理由。

**推荐维度权重**:
| 维度 | 权重 | 说明 |
|------|------|------|
| 价格 | ⭐⭐⭐ | 性价比优先 |
| 时间匹配度 | ⭐⭐⭐ | 与用户偏好时段吻合 |
| 直飞 vs 经停 | ⭐⭐ | 直飞优先 |
| 机型大小 | ⭐⭐ | 宽体机(大)加分 |
| 航司品牌 | ⭐ | 三大航（国航/东航/南航）加分 |

**推荐格式**:
```
✈️ 出发城市 → 到达城市 YYYY-MM-DD 航班推荐

🏆 首选: CA1702 国航 | 07:30-09:50 | 萧山T4→首都T3 | ¥680 | 直飞 | 空客330(大)
   推荐理由: 价格适中，早班出发，宽体机乘坐舒适

⭐ 次选: MU5131 东航 | 08:15-10:40 | 萧山T4→大兴 | ¥620 | 直飞
   推荐理由: 最低价，三大航品质保障

💡 第三选: HU7182 海航 | 10:00-12:25 | 萧山T4→首都T1 | ¥550 | 直飞
   推荐理由: 上午出发时间灵活，性价比高

📊 本次共搜索到 N 个航班，如需查看全部或按其他条件筛选请告诉我。
```

然后主动询问用户：**是否要购买其中某个航班？**

---

## 流程四: 展开报价

**触发**: 用户确认要购买某个航班

**步骤**:

1. 运行展开报价脚本:
   ```bash
   cd /home/node/.openclaw/skills/ctrip-flight && node scripts/expand-prices.js --from 杭州 --to 北京 --date 2026-03-30 --flightNo MU5148
   ```
   或按序号：
   ```bash
   cd /home/node/.openclaw/skills/ctrip-flight && node scripts/expand-prices.js --from 杭州 --to 北京 --date 2026-03-30 --index 0
   ```
2. 解析返回的服务选项列表，向用户展示：
   - 舱位等级、折扣
   - 价格
   - 退改规则、行李额
   - 附加服务包
3. **默认选择价格最低的服务**，告知用户你的选择及价格。
4. 等用户确认后进入**流程五**。

---

## 流程五: 预订下单

**触发**: 用户确认服务选项

**步骤**:

1. 点击预订进入下单页:
   ```bash
   cd /home/node/.openclaw/skills/ctrip-flight && node scripts/book-flight.js --flightNo MU5148 --serviceIndex 0
   ```
2. 脚本会返回已保存的乘机人列表。
3. 向用户展示乘机人列表，询问为哪些人购买，或是否需要新增。

---

## 流程六: 选择乘机人

**触发**: 用户指定乘机人

**步骤**:

1. 选择已有乘机人:
   ```bash
   cd /home/node/.openclaw/skills/ctrip-flight && node scripts/select-passenger.js --select "张三,李四"
   ```
2. 新增乘机人（需用户提供姓名、身份证、手机号）:
   ```bash
   cd /home/node/.openclaw/skills/ctrip-flight && node scripts/select-passenger.js \
     --add --name "王五" --idcard "320xxx" --phone "138xxx"
   ```
3. 完成后进入**流程七**。

---

## 流程七: 确认支付

**触发**: 乘机人选择完成

```bash
cd /home/node/.openclaw/skills/ctrip-flight && node scripts/confirm-order.js
```

脚本会自动:
1. 勾选"我已阅读并同意购票须知"
2. 点击"去支付"
3. 关闭保险弹窗（选"否"）
4. 跳转到 `my.ctrip.com/myinfo/flight` 验证订单

验证成功后告知用户：**订单已创建，请在携程 App 中完成支付。**

---

## 结果展示规范

航班搜索结果应以**表格**或**列表**形式展示，每条航班包含:
- 航班号 + 航司
- 出发/到达时间
- 出发/到达机场
- 价格
- 经停/直飞
- 机型
- 舱位折扣

---

## 错误处理

| 情况 | 处理 |
|------|------|
| CDP 连接失败 | 提示用户检查浏览器容器是否运行 |
| 携程页面加载超时 | 等待 5 秒后重试一次 |
| 二维码过期 | 重新运行 `node scripts/login.js` |
| 搜索无结果 | 建议用户换日期或放宽条件 |
| 展开报价失败 | 确认航班号是否正确，重新搜索 |
| 下单页面异常 | 截图后告知用户手动操作 |

## 文件路径

| 文件 | 路径 |
|------|------|
| Cookie | `/home/node/.openclaw/workspace/ctrip_cookies.json` |
| Auth 状态 | `/home/node/.openclaw/workspace/.auth/ctrip_auth.json` |
| 截图 | `/tmp/ctrip_*.png` |
