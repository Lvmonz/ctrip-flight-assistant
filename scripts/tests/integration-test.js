#!/usr/bin/env node
/**
 * integration-test.js — 端到端集成测试
 * 
 * 测试用例:
 *   TC1: 基础搜索（杭州→北京）
 *   TC2: 排序搜索（按价格）
 *   TC3: 过滤搜索（仅直飞 + 最高价500）
 *   TC4: 航司过滤
 *   TC5: 展开报价面板
 *   TC6: 第二个航班报价展开
 */

const { execSync } = require('child_process');
const path = require('path');

const SKILL_DIR = '/home/node/.openclaw/skills/ctrip-flight';
const CMD_PREFIX = `cd ${SKILL_DIR} &&`;

const results = [];

function run(name, cmd, validator) {
    const label = `[TC] ${name}`;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${label}`);
    console.log(`CMD: ${cmd}`);
    console.log('='.repeat(60));

    try {
        const stdout = execSync(cmd, {
            timeout: 120000,
            encoding: 'utf-8',
            cwd: SKILL_DIR,
        });

        // Parse JSON outputs (there may be multiple JSON objects)
        const jsonBlocks = stdout.match(/\{[\s\S]*?\n\}/g) || [];
        const parsed = jsonBlocks.map(b => {
            try { return JSON.parse(b); } catch { return null; }
        }).filter(Boolean);

        const lastResult = parsed[parsed.length - 1];

        if (!lastResult) {
            results.push({ name, status: 'FAIL', reason: 'No JSON output', raw: stdout.substring(0, 300) });
            console.log(`❌ FAIL: No JSON output`);
            return null;
        }

        // Run validator
        const validation = validator(lastResult, parsed);
        if (validation === true) {
            results.push({ name, status: 'PASS', data: summarize(lastResult) });
            console.log(`✅ PASS`);
        } else {
            results.push({ name, status: 'FAIL', reason: validation, data: summarize(lastResult) });
            console.log(`❌ FAIL: ${validation}`);
        }

        return lastResult;
    } catch (err) {
        const msg = err.stderr?.substring(0, 200) || err.message.substring(0, 200);
        results.push({ name, status: 'ERROR', reason: msg });
        console.log(`💥 ERROR: ${msg}`);
        return null;
    }
}

function summarize(obj) {
    if (!obj) return {};
    return {
        status: obj.status,
        totalFlights: obj.totalFlights,
        success: obj.success,
        firstFlight: obj.flights?.[0]?.flightNo,
        servicesCount: obj.services?.length,
    };
}

// ============================================================
//  TC1: 基础搜索
// ============================================================
run(
    'TC1: 基础搜索 杭州→北京',
    `${CMD_PREFIX} node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-03-30 --cabin economy`,
    (result) => {
        if (!result.success) return `success is false: ${result.error}`;
        if (result.status !== 'found') return `status is ${result.status}, expected found`;
        if (!result.totalFlights || result.totalFlights < 5) return `only ${result.totalFlights} flights, expected >=5`;
        if (!result.flights || result.flights.length === 0) return 'flights array empty';
        const f = result.flights[0];
        if (!f.airline) return 'first flight missing airline';
        if (!f.departTime) return 'first flight missing departTime';
        if (!f.price) return 'first flight missing price';
        if (!f.departAirport) return 'first flight missing departAirport';
        return true;
    }
);

// ============================================================
//  TC2: 按价格排序
// ============================================================
run(
    'TC2: 价格排序搜索',
    `${CMD_PREFIX} node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-03-30 --sort price`,
    (result) => {
        if (!result.success) return `success is false`;
        if (result.totalFlights < 5) return `only ${result.totalFlights} flights`;
        // Verify price order
        const prices = result.flights.map(f => {
            const m = f.price?.match(/(\d+)/);
            return m ? parseInt(m[1]) : Infinity;
        });
        for (let i = 1; i < prices.length; i++) {
            if (prices[i] < prices[i - 1]) return `price not sorted: ${prices[i - 1]} > ${prices[i]} at index ${i}`;
        }
        return true;
    }
);

// ============================================================
//  TC3: 过滤搜索（直飞 + 最高价500）
// ============================================================
run(
    'TC3: 直飞 + 最高价500',
    `${CMD_PREFIX} node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-03-30 --direct --maxPrice 500 --sort price`,
    (result) => {
        if (!result.success) return `success is false`;
        // All must be 直飞 and price <= 500
        for (const f of result.flights) {
            if (f.stops && f.stops !== '直飞') return `flight ${f.flightNo} has stop: ${f.stops}`;
            const p = f.price?.match(/(\d+)/);
            if (p && parseInt(p[1]) > 500) return `flight ${f.flightNo} price ${f.price} > 500`;
        }
        return true;
    }
);

// ============================================================
//  TC4: 航司过滤
// ============================================================
run(
    'TC4: 航司过滤 (东方航空)',
    `${CMD_PREFIX} node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-03-30 --airline 东方航空`,
    (result) => {
        if (!result.success) return `success is false`;
        if (result.totalFlights === 0) return 'no flights found for 东方航空';
        for (const f of result.flights) {
            if (!f.airline.includes('东方航空')) return `flight ${f.flightNo} airline is ${f.airline}`;
        }
        return true;
    }
);

// ============================================================
//  TC5: 展开第一个航班报价
// ============================================================
// First, need to navigate to search page, then expand
run(
    'TC5: 展开首个航班报价',
    `${CMD_PREFIX} node scripts/search-flights.js --from 杭州 --to 北京 --date 2026-03-30 --sort price 2>&1 && sleep 2 && node scripts/expand-prices.js --index 0 2>&1`,
    (result, allResults) => {
        // The expand result should be the last one
        const expandResult = allResults.find(r => r.status === 'expanded');
        if (!expandResult) return 'expand result not found';
        if (!expandResult.success) return 'expand not successful';
        if (!expandResult.flight) return 'no flight info in expand result';
        if (!expandResult.services || expandResult.services.length === 0) return 'no services found';
        return true;
    }
);

// ============================================================
//  输出最终报告
// ============================================================
console.log('\n\n' + '='.repeat(60));
console.log('📊 集成测试报告');
console.log('='.repeat(60));
console.log(`测试时间: ${new Date().toISOString()}`);
console.log(`测试环境: OpenClaw Docker Container`);
console.log(`目标站点: flights.ctrip.com`);
console.log('');

let passCount = 0, failCount = 0, errorCount = 0;
for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '💥';
    console.log(`${icon} ${r.name}: ${r.status}`);
    if (r.reason) console.log(`   原因: ${r.reason}`);
    if (r.data) console.log(`   数据: ${JSON.stringify(r.data)}`);
    if (r.status === 'PASS') passCount++;
    else if (r.status === 'FAIL') failCount++;
    else errorCount++;
}

console.log('');
console.log(`通过: ${passCount} | 失败: ${failCount} | 错误: ${errorCount} | 总计: ${results.length}`);
console.log('='.repeat(60));

process.exit(failCount + errorCount > 0 ? 1 : 0);
