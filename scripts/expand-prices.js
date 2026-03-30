#!/usr/bin/env node
/**
 * expand-prices.js — 展开航班报价面板，解析服务与定价
 *
 * 使用方式:
 *   node expand-prices.js --from 杭州 --to 北京 --date 2026-03-30 --flightNo MU5148
 *   node expand-prices.js --from 杭州 --to 北京 --date 2026-03-30 --index 0
 *
 * 参数:
 *   --from      出发城市（中文或三字码）
 *   --to        到达城市（中文或三字码）
 *   --date      出发日期 YYYY-MM-DD
 *   --cabin     舱位（默认 economy）
 *   --flightNo  航班号（如 MU5148）
 *   --index     航班在列表中的序号（从 0 开始）
 *
 * 输出: JSON（航班信息 + 服务选项数组含价格、退改、行李等）
 */

const {
    connectBrowser, getPage, waitFor, waitForSelector,
    loadCookies, saveCookies, screenshot, output, outputError,
} = require('./browser-utils');

// 城市映射（复用 search-flights.js 的逻辑）
const CITY_MAP = {
    '北京': 'BJS', '上海': 'SHA', '广州': 'CAN', '深圳': 'SZX', '杭州': 'HGH',
    '成都': 'CTU', '重庆': 'CKG', '武汉': 'WUH', '西安': 'SIA', '南京': 'NKG',
    '天津': 'TSN', '青岛': 'TAO', '大连': 'DLC', '厦门': 'XMN', '长沙': 'CSX',
    '昆明': 'KMG', '三亚': 'SYX', '海口': 'HAK', '贵阳': 'KWE', '郑州': 'CGO',
    '哈尔滨': 'HRB', '沈阳': 'SHE', '拉萨': 'LXA', '乌鲁木齐': 'URC',
    '香港': 'HKG', '台北': 'TPE', '澳门': 'MFM',
};
function resolveCity(input) {
    if (!input) return null;
    const upper = input.toUpperCase();
    if (/^[A-Z]{3}$/.test(upper)) return upper;
    return CITY_MAP[input] || null;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const params = { cabin: 'economy' };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--flightNo': params.flightNo = args[++i]; break;
            case '--index': params.index = parseInt(args[++i], 10); break;
            case '--from': params.from = args[++i]; break;
            case '--to': params.to = args[++i]; break;
            case '--date': params.date = args[++i]; break;
            case '--cabin': params.cabin = args[++i]; break;
        }
    }
    return params;
}

// ============================================================
//  滚动加载全量航班（与 search-flights.js 保持一致）
// ============================================================
async function scrollToLoadAll(page) {
    await page.mouse.move(150, 200);
    await page.mouse.click(150, 200);
    for (let i = 0; i < 30; i++) {
        await page.mouse.wheel({ deltaY: 500 });
        await page.mouse.move(100 + Math.random() * 100, 100 + Math.random() * 100);
        await waitFor(500);
    }
    await waitFor(3000);
    const count = await page.evaluate(() => document.querySelectorAll('.flight-item').length);
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitFor(500);
    return count;
}

async function main() {
    const params = parseArgs();

    if (params.flightNo === undefined && params.index === undefined) {
        outputError('缺少参数', { usage: 'node expand-prices.js --from 杭州 --to 北京 --date 2026-03-30 --flightNo MU5148 或 --index 0' });
        process.exit(1);
    }

    let browser;
    try {
        browser = await connectBrowser();
        const page = await getPage(browser);

        // 如果不在搜索页，自动导航
        const currentUrl = page.url();
        if (!currentUrl.includes('flights.ctrip.com/online/list/')) {
            if (!params.from || !params.to || !params.date) {
                outputError('当前页面不是搜索结果页，需要 --from, --to, --date 参数来导航', { url: currentUrl });
                process.exit(1);
            }
            const fromCode = resolveCity(params.from);
            const toCode = resolveCity(params.to);
            if (!fromCode || !toCode) {
                outputError('无法识别城市');
                process.exit(1);
            }
            const cabinParam = (params.cabin === 'business' || params.cabin === 'first') ? 'c_f' : 'y_s_c_f';
            const searchUrl = `https://flights.ctrip.com/online/list/oneway-${fromCode}-${toCode}?depdate=${params.date}&cabin=${cabinParam}`;

            await loadCookies(page);
            output({ status: 'navigating', message: `正在导航到搜索页...` });
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 45000 });
            await waitFor(8000);
        }

        // 等待航班卡片
        await waitForSelector(page, '.flight-item', 15000);

        // 滚动加载全量航班（关键！不滚动只有前 15 条）
        const totalLoaded = await scrollToLoadAll(page);
        output({ status: 'loaded', message: `已加载 ${totalLoaded} 条航班` });

        // 定位目标航班
        const targetIndex = await page.evaluate((flightNo, idx) => {
            const items = document.querySelectorAll('.flight-item');
            if (idx !== undefined && idx !== null) return idx;
            // 按航班号查找
            for (let i = 0; i < items.length; i++) {
                const noEl = items[i].querySelector('.plane-No');
                if (noEl && noEl.textContent.includes(flightNo)) return i;
            }
            return -1;
        }, params.flightNo || null, params.index !== undefined ? params.index : null);

        if (targetIndex < 0) {
            outputError(`未找到航班 ${params.flightNo}`, { hint: '请确认航班号是否在当前搜索结果中' });
            process.exit(1);
        }

        // 滚动到目标航班使其可见（必须！否则 click 无效）
        await page.evaluate((idx) => {
            const items = document.querySelectorAll('.flight-item');
            items[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, targetIndex);
        await waitFor(1000);

        // 获取目标航班基本信息
        const flightInfo = await page.evaluate((idx) => {
            const items = document.querySelectorAll('.flight-item');
            const item = items[idx];
            if (!item) return null;
            return {
                airline: item.querySelector('.flight-airline .airline-name span')?.textContent?.trim() || '',
                flightNo: (item.querySelector('.plane-No')?.textContent?.trim() || '').match(/^([A-Z\d]+)/)?.[1] || '',
                departTime: item.querySelector('.depart-box .time')?.textContent?.trim() || '',
                arriveTime: item.querySelector('.arrive-box .time')?.textContent?.trim() || '',
                departAirport: (item.querySelector('.depart-box .airport .name')?.textContent?.trim() || '') +
                    (item.querySelector('.depart-box .airport .terminal')?.textContent?.trim() || ''),
                arriveAirport: (item.querySelector('.arrive-box .airport .name')?.textContent?.trim() || '') +
                    (item.querySelector('.arrive-box .airport .terminal')?.textContent?.trim() || ''),
            };
        }, targetIndex);

        output({ status: 'expanding', message: `正在展开 ${flightInfo?.flightNo || ''} ${flightInfo?.airline || ''} 的报价...` });

        // 点击目标航班内部的"订票"按钮（使用 per-item querySelector 而非全局索引！）
        const clickResult = await page.evaluate((idx) => {
            const items = document.querySelectorAll('.flight-item');
            const item = items[idx];
            if (!item) return 'no_item';
            const btn = item.querySelector('.btn-book');
            if (!btn) return 'no_btn';
            btn.click();
            return 'clicked';
        }, targetIndex);

        if (clickResult !== 'clicked') {
            outputError('找不到订票按钮', { index: targetIndex, result: clickResult });
            process.exit(1);
        }

        await waitFor(3000);

        // 截图展开后的面板
        const shotResult = await screenshot(page, 'expanded_prices');

        // 解析展开后的服务选项
        const services = await page.evaluate((idx) => {
            const items = document.querySelectorAll('.flight-item');
            const item = items[idx];
            if (!item) return [];

            const results = [];

            // 展开后的 DOM 结构:
            //   .flight-seats
            //     .seat-row
            //       .domestic-cabin-item → 舱位折扣
            //       .seat-price → 价格
            //       .rules → 退改/行李
            //       .servicePackage → 服务包内容
            const cabinItems = item.querySelectorAll('.domestic-cabin-item');
            const seatPrices = item.querySelectorAll('.seat-price');
            const rulesEls = item.querySelectorAll('.rules');

            for (let i = 0; i < Math.max(cabinItems.length, seatPrices.length); i++) {
                const cabin = cabinItems[i]?.textContent?.trim() || '';
                const priceEl = seatPrices[i];
                const rulesEl = rulesEls[i];

                let price = '';
                let servicePack = '';
                if (priceEl) {
                    price = priceEl.textContent?.trim() || '';
                }

                const rules = rulesEl?.textContent?.trim() || '';

                // 找到对应 seat-row 中的 servicePackage
                const seatRow = cabinItems[i]?.closest('.seat-row') || seatPrices[i]?.closest('.seat-row');
                const serviceEl = seatRow?.querySelector('.servicePackage');
                servicePack = serviceEl?.textContent?.trim() || '';

                results.push({
                    index: i,
                    cabinClass: cabin,
                    price,
                    servicePack,
                    rules,
                });
            }

            return results;
        }, targetIndex);

        // 检查是否有"展开查看所有产品"
        const hasExpandAll = await page.evaluate((idx) => {
            const items = document.querySelectorAll('.flight-item');
            const item = items[idx];
            const expandEl = item?.querySelector('.expand-default-collapse-price');
            return expandEl ? expandEl.textContent.trim() : null;
        }, targetIndex);

        output({
            success: true,
            status: 'expanded',
            flight: flightInfo,
            services,
            hasMoreProducts: hasExpandAll || null,
            screenshot: shotResult,
            hint: '使用 book-flight.js --flightNo XXX --serviceIndex N 来预订指定服务',
        });

    } catch (err) {
        outputError(`展开报价失败: ${err.message}`, { stack: err.stack });
        if (browser) await browser.disconnect();
        process.exit(1);
    }

    if (browser) await browser.disconnect();
    process.exit(0);
}

main();

