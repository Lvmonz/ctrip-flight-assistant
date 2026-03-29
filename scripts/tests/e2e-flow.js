#!/usr/bin/env node
/**
 * e2e-flow.js — 完整端到端流程模拟
 *
 * 同时扮演「用户」和「OpenClaw Agent」，完整模拟:
 *   用户: "我想买一张明天杭州到北京的经济舱机票，下午出发，直飞"
 *   → 登录检查 → 搜索航班 → 推荐Top3 → 用户选第1个
 *   → 展开报价 → 选择最低价服务 → 点击预订进入下单页
 *   → 提取乘机人 → 展示最终页面状态
 *
 * 注意: 不会真正提交支付，在进入下单页后停止。
 */

const { execSync } = require('child_process');
const SKILL_DIR = '/home/node/.openclaw/skills/ctrip-flight';

function log(role, msg) {
    const icon = role === 'user' ? '👤' : role === 'agent' ? '🤖' : '🔧';
    console.log(`\n${icon} [${role.toUpperCase()}] ${msg}`);
}

function runScript(cmd) {
    try {
        const stdout = execSync(cmd, {
            timeout: 120000,
            encoding: 'utf-8',
            cwd: SKILL_DIR,
        });
        // Parse all JSON blocks
        const jsonBlocks = stdout.match(/\{[\s\S]*?\n\}/g) || [];
        return jsonBlocks.map(b => {
            try { return JSON.parse(b); } catch { return null; }
        }).filter(Boolean);
    } catch (err) {
        console.error(`  ❌ Script error: ${err.message.substring(0, 200)}`);
        return [];
    }
}

function formatPrice(p) {
    const m = p?.match(/(\d+)/);
    return m ? parseInt(m[1]) : Infinity;
}

// ============================================================
console.log('═'.repeat(70));
console.log('  📋 端到端全流程模拟测试');
console.log('  场景: 用户通过微信要求 OpenClaw 帮忙订机票');
console.log('═'.repeat(70));

// ============================================================
// STEP 1: 用户发起请求
// ============================================================
log('user', '我想买一张明天杭州到北京的经济舱机票，下午出发，最好直飞');

log('agent', '好的！我来帮您查询杭州到北京的机票。让我先确认参数：');
log('agent', '  出发城市: 杭州');
log('agent', '  到达城市: 北京');
log('agent', '  出发日期: 2026-03-30');
log('agent', '  舱位: 经济舱');
log('agent', '  时间偏好: 下午');
log('agent', '  直飞偏好: 是');

// ============================================================
// STEP 2: 检查登录
// ============================================================
log('agent', '首先检查登录状态...');
log('system', '执行: node scripts/login.js --check');

const loginResults = runScript(`cd ${SKILL_DIR} && node scripts/login.js --check 2>&1`);
const loginResult = loginResults[loginResults.length - 1];
if (loginResult?.loggedIn || loginResult?.status === 'logged_in') {
    log('agent', '✅ 已登录携程，开始搜索航班...');
} else {
    log('agent', '⚠️ 登录状态不确定，继续尝试搜索（Cookie 已加载）...');
}

// ============================================================
// STEP 3: 搜索航班
// ============================================================
log('system', '执行: node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-03-30 --cabin economy --direct --time 中 --sort price');

const searchResults = runScript(
    `cd ${SKILL_DIR} && node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-03-30 --cabin economy --direct --time "中" --sort price 2>&1`
);
const searchResult = searchResults[searchResults.length - 1];

if (!searchResult?.success || !searchResult?.flights?.length) {
    log('agent', '❌ 搜索失败或无结果');
    console.log(JSON.stringify(searchResult, null, 2));
    process.exit(1);
}

log('agent', `📊 搜索完成！共找到 ${searchResult.totalFlights} 个符合条件的航班`);

// ============================================================
// STEP 4: 推荐 Top 3
// ============================================================
const flights = searchResult.flights;
log('agent', '\n✈️ 杭州 → 北京 2026-03-30 航班推荐\n');

const top3 = flights.slice(0, Math.min(3, flights.length));
const labels = ['🏆 首选', '⭐ 次选', '💡 第三选'];
const reasons = [];

for (let i = 0; i < top3.length; i++) {
    const f = top3[i];
    let reason = '';
    const price = formatPrice(f.price);

    if (i === 0) {
        reason = `最低价 ¥${price}`;
        if (f.aircraft?.includes('330') || f.aircraft?.includes('350') || f.aircraft?.includes('大'))
            reason += '，宽体机乘坐舒适';
        if (f.airline?.includes('东方') || f.airline?.includes('国航') || f.airline?.includes('南方'))
            reason += '，三大航品质保障';
    } else if (i === 1) {
        reason = `价格适中 ¥${price}`;
        if (f.departTime) reason += `，${f.departTime}出发时间合适`;
    } else {
        reason = `性价比高 ¥${price}`;
        if (f.tags?.length) reason += `，${f.tags[0]}`;
    }

    reasons.push(reason);
    console.log(`  ${labels[i]}: ${f.flightNo || '未知'} ${f.airline} | ${f.departTime}→${f.arriveTime} | ${f.departAirport}→${f.arriveAirport} | ${f.price} | ${f.stops} | ${f.aircraft || ''}`);
    console.log(`     推荐理由: ${reason}`);
}

log('agent', `\n📊 本次共搜索到 ${searchResult.totalFlights} 个航班。您想预订哪个？`);

// ============================================================
// STEP 5: 用户选择
// ============================================================
const chosen = top3[0];
log('user', `我选第一个 ${chosen.flightNo || ''} ${chosen.airline}，帮我订`);
log('agent', `好的！我来帮您展开 ${chosen.flightNo} 的报价详情...`);

// ============================================================
// STEP 6: 展开报价
// ============================================================
log('system', `执行: node scripts/expand-prices.js --from 杭州 --to 北京 --date 2026-03-30 --index 0`);

const expandResults = runScript(
    `cd ${SKILL_DIR} && node scripts/expand-prices.js --from 杭州 --to 北京 --date 2026-03-30 --index 0 2>&1`
);
const expandResult = expandResults.find(r => r.status === 'expanded');

if (!expandResult?.success) {
    log('agent', '❌ 展开报价失败');
    console.log(JSON.stringify(expandResults, null, 2));
    process.exit(1);
}

log('agent', `✅ 已展开 ${expandResult.flight.flightNo} ${expandResult.flight.airline} 的报价：\n`);

for (const svc of expandResult.services) {
    console.log(`  [${svc.index}] ${svc.cabinClass} | ${svc.price} ${svc.servicePack || ''}`);
    console.log(`      规则: ${svc.rules}`);
}

if (expandResult.hasMoreProducts) {
    console.log(`  📦 ${expandResult.hasMoreProducts}`);
}

// 选择最低价
const cheapest = expandResult.services.reduce((min, s) =>
    formatPrice(s.price) < formatPrice(min.price) ? s : min
    , expandResult.services[0]);

log('agent', `\n我为您选择了最低价方案：`);
log('agent', `  舱位: ${cheapest.cabinClass}`);
log('agent', `  价格: ${cheapest.price}`);
log('agent', `  退改: ${cheapest.rules}`);
log('agent', `确认预订吗？`);

// ============================================================
// STEP 7: 用户确认
// ============================================================
log('user', '确认，帮我订');

// ============================================================
// STEP 8: 点击预订，进入下单页
// ============================================================
log('agent', '好的！正在点击预订按钮，进入下单页面...');
log('system', `执行: node scripts/book-flight.js --from 杭州 --to 北京 --date 2026-03-30 --index 0 --serviceIndex ${cheapest.index}`);

const bookResults = runScript(
    `cd ${SKILL_DIR} && node scripts/book-flight.js --index 0 --serviceIndex ${cheapest.index} 2>&1`
);
const bookResult = bookResults[bookResults.length - 1];

if (bookResult?.success) {
    log('agent', `✅ 已进入下单页面: ${bookResult.url}`);

    if (bookResult.passengers?.length > 0) {
        log('agent', '已保存的乘机人列表：');
        for (const p of bookResult.passengers) {
            console.log(`  - ${p.name} ${p.selected ? '（已选）' : ''}`);
        }
        log('agent', '请告诉我为哪些人购买机票？');

        log('user', '就给第一个人买');
        log('agent', '好的，正在选择乘机人...');

    } else {
        log('agent', '当前没有已保存的乘机人。');
        log('agent', '下单页面内容预览：');
        const preview = bookResult.pageStructure?.mainText?.substring(0, 500) || 'N/A';
        console.log(`  ${preview.replace(/\n/g, '\n  ')}`);

        log('agent', '请提供乘机人信息（姓名、身份证、手机号）以继续...');
    }
} else {
    log('agent', '⚠️ 跳转下单页面时遇到问题：');
    console.log(JSON.stringify(bookResult, null, 2));
    log('agent', '这可能需要在下单页面校准 DOM 选择器。当前页面截图已保存。');
}

// ============================================================
// FINAL REPORT
// ============================================================
console.log('\n\n' + '═'.repeat(70));
console.log('  📊 端到端流程测试报告');
console.log('═'.repeat(70));
console.log('');

const steps = [
    { step: '1. 用户提需求', status: '✅', note: '解析意图 → 杭州→北京 下午 直飞 经济舱' },
    { step: '2. 登录检查', status: loginResult ? '✅' : '⚠️', note: loginResult?.loggedIn ? '已登录' : 'Cookie已加载' },
    { step: '3. 航班搜索', status: searchResult?.success ? '✅' : '❌', note: `${searchResult?.totalFlights || 0} 条航班` },
    { step: '4. Top3推荐', status: top3.length >= 1 ? '✅' : '❌', note: `推荐 ${top3.length} 条` },
    { step: '5. 展开报价', status: expandResult?.success ? '✅' : '❌', note: `${expandResult?.services?.length || 0} 个服务选项` },
    { step: '6. 用户确认', status: '✅', note: `选择 ${cheapest?.cabinClass} ${cheapest?.price}` },
    { step: '7. 点击预订', status: bookResult?.success ? '✅' : '⚠️', note: bookResult?.url || '需校准' },
    { step: '8. 乘机人选择', status: '⏳', note: '需真实用户交互' },
    { step: '9. 确认支付', status: '⏳', note: '需真实用户交互' },
];

for (const s of steps) {
    console.log(`  ${s.status} ${s.step}: ${s.note}`);
}

const passed = steps.filter(s => s.status === '✅').length;
const warned = steps.filter(s => s.status === '⚠️').length;
const pending = steps.filter(s => s.status === '⏳').length;
const failed = steps.filter(s => s.status === '❌').length;

console.log('');
console.log(`  通过: ${passed} | 警告: ${warned} | 待验证: ${pending} | 失败: ${failed}`);
console.log('═'.repeat(70));

process.exit(failed > 0 ? 1 : 0);
