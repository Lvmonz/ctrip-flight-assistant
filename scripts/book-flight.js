#!/usr/bin/env node
/**
 * book-flight.js — 点击预订按钮进入下单页，提取乘机人列表
 *
 * 使用方式:
 *   node book-flight.js --from 杭州 --to 北京 --date 2026-03-30 --flightNo MU5148 --serviceIndex 0
 *   node book-flight.js --from 杭州 --to 北京 --date 2026-03-30 --index 0 --serviceIndex 0
 *
 * 输出: 下单页面信息 + 已保存的乘机人列表 JSON
 */

const {
    connectBrowser, getPage, waitFor, waitForSelector,
    loadCookies, saveCookies, screenshot, output, outputError,
} = require('./browser-utils');

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
    const params = { serviceIndex: 0, cabin: 'economy' };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--flightNo': params.flightNo = args[++i]; break;
            case '--index': params.index = parseInt(args[++i], 10); break;
            case '--serviceIndex': params.serviceIndex = parseInt(args[++i], 10); break;
            case '--from': params.from = args[++i]; break;
            case '--to': params.to = args[++i]; break;
            case '--date': params.date = args[++i]; break;
            case '--cabin': params.cabin = args[++i]; break;
        }
    }
    return params;
}

async function main() {
    const params = parseArgs();
    let browser;

    try {
        browser = await connectBrowser();
        const page = await getPage(browser);

        const currentUrl = page.url();

        // 如果不在搜索列表页，自动导航
        if (!currentUrl.includes('flights.ctrip.com/online/list/')) {
            if (!params.from || !params.to || !params.date) {
                outputError('当前页面不在搜索列表页，需要 --from, --to, --date 参数来导航', { url: currentUrl });
                process.exit(1);
            }
            const fromCode = resolveCity(params.from);
            const toCode = resolveCity(params.to);
            if (!fromCode || !toCode) {
                outputError('无法识别城市');
                process.exit(1);
            }
            const cabinParam = (params.cabin === 'business' || params.cabin === 'first') ? 'c_f' : 'y_s_c_f';
            const searchUrl = `https://flights.ctrip.com/online/list/oneway-${fromCode}-${toCode}?depdate=${params.date}&cabin=${cabinParam}&adult=1&child=0&infant=0`;

            await loadCookies(page);
            output({ status: 'navigating', message: '正在导航到搜索页...' });
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 45000 });
            await waitFor(10000);
        }

        await waitFor(2000);

        // 在搜索列表页上操作
        await waitForSelector(page, '.flight-item', 15000);

        // 定位目标航班
        const targetIndex = await page.evaluate((flightNo, idx) => {
            const items = document.querySelectorAll('.flight-item');
            if (idx !== undefined && idx !== null) return idx;
            for (let i = 0; i < items.length; i++) {
                const noEl = items[i].querySelector('.plane-No');
                if (noEl && noEl.textContent.includes(flightNo)) return i;
            }
            return -1;
        }, params.flightNo || null, params.index !== undefined ? params.index : null);

        if (targetIndex < 0) {
            outputError(`未找到目标航班`);
            process.exit(1);
        }

        // 点击"订票"按钮展开（如果还没展开）
        const isExpanded = await page.evaluate((idx) => {
            const items = document.querySelectorAll('.flight-item');
            const item = items[idx];
            return item && item.querySelectorAll('.domestic-cabin-item').length > 0;
        }, targetIndex);

        if (!isExpanded) {
            const bookBtns = await page.$$('.btn-book');
            if (bookBtns[targetIndex]) {
                await bookBtns[targetIndex].click();
                await waitFor(3000);
            }
        }

        // 点击目标服务的"预订/选购"按钮
        output({ status: 'booking', message: `正在点击第 ${params.serviceIndex} 个服务的预订按钮...` });

        const clicked = await page.evaluate((flightIdx, svcIdx) => {
            const items = document.querySelectorAll('.flight-item');
            const item = items[flightIdx];
            if (!item) return false;
            // 找到所有"预订"或"选购"按钮（排除"收起"和"订票"）
            const btns = Array.from(item.querySelectorAll('.btn-book')).filter(b => {
                const text = b.textContent.trim();
                return text === '预订' || text === '选购';
            });
            if (btns[svcIdx]) {
                btns[svcIdx].click();
                return true;
            }
            return false;
        }, targetIndex, params.serviceIndex);

        if (!clicked) {
            outputError('未找到预订/选购按钮', { serviceIndex: params.serviceIndex });
            process.exit(1);
        }

        // 等待页面跳转到下单页
        await waitFor(5000);
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => { });
        await waitFor(3000);

        const orderUrl = page.url();
        await screenshot(page, 'order_page');

        output({ status: 'order_page', message: `已进入下单页面`, url: orderUrl });

        // 提取乘机人列表
        const passengers = await page.evaluate(() => {
            const result = [];
            // 查找已保存的乘机人
            const passengerEls = document.querySelectorAll(
                '[class*="passenger"], [class*="traveler"], [class*="contact"]'
            );
            for (const el of passengerEls) {
                const name = el.querySelector('[class*="name"]')?.textContent?.trim();
                if (name && name.length >= 2 && name.length <= 10) {
                    const checked = el.querySelector('input[type="checkbox"]')?.checked ||
                        el.classList.contains('selected') ||
                        el.querySelector('[class*="checked"]') !== null;
                    result.push({
                        name,
                        selected: !!checked,
                        text: el.innerText?.replace(/\n/g, ' ').substring(0, 100),
                    });
                }
            }
            return result;
        });

        // 获取页面上所有可点击元素的文字（帮助 Agent 理解页面结构）
        const pageStructure = await page.evaluate(() => {
            const text = document.body.innerText;
            return {
                title: document.title,
                textLength: text.length,
                hasPassengerSection: text.includes('乘机人') || text.includes('旅客'),
                hasAddPassenger: text.includes('新增乘机人') || text.includes('添加乘机人'),
                mainText: text.substring(0, 2000),
            };
        });

        output({
            success: true,
            status: 'ready',
            url: orderUrl,
            passengers,
            pageStructure,
            hint: '使用 select-passenger.js 选择或新增乘机人',
        });

    } catch (err) {
        outputError(`预订跳转失败: ${err.message}`, { stack: err.stack });
        if (browser) await browser.disconnect();
        process.exit(1);
    }

    if (browser) await browser.disconnect();
    process.exit(0);
}

main();
