#!/usr/bin/env node
/**
 * search-flights.js — 携程航班搜索脚本
 *
 * 使用方式:
 *   node search-flights.js --from 杭州 --to 北京 --date 2026-04-05
 *   node search-flights.js --from SHA --to PEK --date 2026-04-05 --cabin economy
 *
 * 参数:
 *   --from    出发城市（中文名或三字码）
 *   --to      到达城市（中文名或三字码）
 *   --date    出发日期（YYYY-MM-DD）
 *   --cabin   舱位: economy | business | first（默认 economy）
 *   --direct  仅直飞（可选）
 *
 * 输出 JSON 到 stdout
 */

const {
    connectBrowser, getPage, waitFor, waitForSelector,
    loadCookies, saveCookies, screenshot, output, outputError,
} = require('./browser-utils');

// ============================================================
//  城市映射（常用城市 → 携程 URL 参数）
// ============================================================

const CITY_MAP = {
    // 中文名 → 城市编码
    '北京': 'BJS', '上海': 'SHA', '广州': 'CAN', '深圳': 'SZX',
    '杭州': 'HGH', '成都': 'CTU', '重庆': 'CKG', '武汉': 'WUH',
    '西安': 'SIA', '南京': 'NKG', '天津': 'TSN', '青岛': 'TAO',
    '大连': 'DLC', '厦门': 'XMN', '长沙': 'CSX', '昆明': 'KMG',
    '三亚': 'SYX', '海口': 'HAK', '贵阳': 'KWE', '郑州': 'CGO',
    '哈尔滨': 'HRB', '沈阳': 'SHE', '拉萨': 'LXA', '乌鲁木齐': 'URC',
    '香港': 'HKG', '台北': 'TPE', '澳门': 'MFM',
};

function resolveCity(input) {
    if (!input) return null;
    const upper = input.toUpperCase();
    // 已经是三字码
    if (/^[A-Z]{3}$/.test(upper)) return upper;
    // 中文匹配
    return CITY_MAP[input] || null;
}

// ============================================================
//  解析命令行参数
// ============================================================

function parseArgs() {
    const args = process.argv.slice(2);
    const params = { cabin: 'economy', direct: false };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--from': params.from = args[++i]; break;
            case '--to': params.to = args[++i]; break;
            case '--date': params.date = args[++i]; break;
            case '--cabin': params.cabin = args[++i]; break;
            case '--direct': params.direct = true; break;
            case '--time': params.time = args[++i]; break;
            case '--airport': params.airport = args[++i]; break;
            case '--largeOnly': params.largeOnly = args[++i] === 'true'; break;
        }
    }

    return params;
}

// ============================================================
//  构造携程搜索 URL
// ============================================================

function buildSearchUrl(from, to, date, cabin) {
    let cabinParam = 'y_s_c_f';
    if (cabin === 'business' || cabin === 'first' || cabin === '商务' || cabin === '头等' || cabin === 'c_f') cabinParam = 'c_f';
    // 携程国内航班搜索 URL 格式
    return `https://flights.ctrip.com/online/list/oneway-${from}-${to}?depdate=${date}&cabin=${cabinParam}&adult=1&child=0&infant=0`;
}

// ============================================================
//  解析航班列表
// ============================================================

async function parseFlightList(page) {
    return await page.evaluate(() => {
        const flights = [];
        // 携程航班列表卡片选择器（可能随版本变化，提供多种备选）
        const cards = document.querySelectorAll(
            '[class*="flight-item"], [class*="FlightItem"], .list-item, [class*="flight_item"]'
        );

        for (const card of cards) {
            try {
                // 航司
                const airlineEl = card.querySelector(
                    '[class*="airline"], [class*="air-name"], [class*="carrier"]'
                );
                // 航班号
                const flightNoEl = card.querySelector(
                    '[class*="flight-no"], [class*="flightNo"], [class*="flight_number"]'
                );
                // 出发时间
                const depTimeEl = card.querySelector(
                    '[class*="depart-time"], [class*="dep-time"], [class*="time"]:first-child'
                );
                // 到达时间
                const arrTimeEl = card.querySelector(
                    '[class*="arrive-time"], [class*="arr-time"]'
                );
                // 出发机场
                const depAirportEl = card.querySelector(
                    '[class*="depart-airport"], [class*="dep-airport"]'
                );
                // 到达机场
                const arrAirportEl = card.querySelector(
                    '[class*="arrive-airport"], [class*="arr-airport"]'
                );
                // 价格
                const priceEl = card.querySelector(
                    '[class*="price"], [class*="Price"], .price'
                );
                // 经停信息
                const stopEl = card.querySelector(
                    '[class*="stop"], [class*="transfer"]'
                );
                // 机型
                const planeEl = card.querySelector(
                    '[class*="plane"], [class*="craft"], [class*="aircraft"]'
                );
                // 准点率
                const onTimeEl = card.querySelector(
                    '[class*="on-time"], [class*="punctual"]'
                );

                const flight = {
                    airline: airlineEl?.textContent?.trim() || '',
                    flightNo: flightNoEl?.textContent?.trim() || '',
                    departTime: depTimeEl?.textContent?.trim() || '',
                    arriveTime: arrTimeEl?.textContent?.trim() || '',
                    departAirport: depAirportEl?.textContent?.trim() || '',
                    arriveAirport: arrAirportEl?.textContent?.trim() || '',
                    price: priceEl?.textContent?.trim() || '',
                    stops: stopEl?.textContent?.trim() || '直飞',
                    aircraft: planeEl?.textContent?.trim() || '',
                    onTimeRate: onTimeEl?.textContent?.trim() || '',
                };

                // 至少有航班号或时间才算有效
                if (flight.flightNo || flight.departTime) {
                    flights.push(flight);
                }
            } catch {
                // 忽略单个卡片解析失败
            }
        }

        return flights;
    });
}

/**
 * 备用解析：如果结构化选择器失败，尝试从页面文本提取
 */
async function parseFlightListFallback(page) {
    return await page.evaluate(() => {
        const text = document.body.innerText;
        // 检查是否有搜索结果
        if (text.includes('没有找到') || text.includes('无航班') || text.includes('暂无')) {
            return { noResult: true, message: '未找到符合条件的航班' };
        }
        // 返回页面原始文本的关键部分供 Agent 智能解析
        const lines = text.split('\n').filter(l => l.trim());
        // 提取看起来像航班信息的行
        const flightLines = lines.filter(l =>
            /\d{1,2}:\d{2}/.test(l) || // 包含时间
            /[A-Z]{2}\d{3,4}/.test(l) || // 航班号
            /¥/.test(l) || // 价格
            /经停|直飞|中转/.test(l) // 经停信息
        );
        return { rawLines: flightLines.slice(0, 50) };
    });
}

// ============================================================
//  主流程
// ============================================================

async function main() {
    const params = parseArgs();

    // 参数校验
    if (!params.from || !params.to || !params.date) {
        outputError('缺少必要参数', {
            usage: 'node search-flights.js --from 杭州 --to 北京 --date 2026-04-05',
            params,
        });
        process.exit(1);
    }

    const fromCode = resolveCity(params.from);
    const toCode = resolveCity(params.to);

    if (!fromCode) {
        outputError(`无法识别出发城市: ${params.from}`, { hint: '请使用中文城市名或三字码(如 HGH)' });
        process.exit(1);
    }
    if (!toCode) {
        outputError(`无法识别到达城市: ${params.to}`, { hint: '请使用中文城市名或三字码(如 PEK)' });
        process.exit(1);
    }

    let browser;
    try {
        browser = await connectBrowser();
        const page = await getPage(browser);

        // 恢复 Cookie
        await loadCookies(page);

        // 构造搜索 URL
        const searchUrl = buildSearchUrl(fromCode, toCode, params.date, params.cabin);

        output({
            status: 'searching',
            message: `正在搜索 ${params.from}(${fromCode}) → ${params.to}(${toCode}) ${params.date} 的航班...`,
            url: searchUrl,
        });

        // 导航到搜索页
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 等待航班列表加载
        await waitFor(5000);

        // 尝试等待航班卡片出现
        const hasCards = await waitForSelector(page,
            '[class*="flight-item"], [class*="FlightItem"], .list-item, [class*="flight_item"]',
            15000
        );

        // 截图搜索结果
        const shotResult = await screenshot(page, 'search_result');

        let flights;
        if (hasCards) {
            flights = await parseFlightList(page);
        }

        // 如果结构化解析结果为空，使用备用方案
        if (!flights || flights.length === 0) {
            const fallback = await parseFlightListFallback(page);
            if (fallback.noResult) {
                output({
                    success: true,
                    status: 'no_flights',
                    message: fallback.message,
                    query: { from: params.from, to: params.to, date: params.date },
                    screenshot: shotResult,
                });
                return;
            }

            output({
                success: true,
                status: 'raw_result',
                message: '航班列表已加载，但结构化解析未匹配到卡片，返回原始数据供分析',
                rawLines: fallback.rawLines,
                query: { from: params.from, to: params.to, date: params.date },
                screenshot: shotResult,
            });
            return;
        }

        // 自定义条件过滤
        let resultFlights = flights;
        if (params.direct) {
            resultFlights = resultFlights.filter(f => f.stops === '直飞' || !f.stops);
        }
        if (params.time && params.time !== '无所谓') {
            resultFlights = resultFlights.filter(f => {
                if (!f.departTime) return true;
                const hour = parseInt(f.departTime.split(':')[0], 10);
                if (params.time.includes('早') && hour < 12) return true;
                if (params.time.includes('中') && hour >= 10 && hour <= 15) return true;
                if (params.time.includes('晚') && hour > 15) return true;
                return false;
            });
        }
        if (params.airport && params.airport !== '无所谓') {
            resultFlights = resultFlights.filter(f =>
                (f.departAirport && f.departAirport.includes(params.airport)) ||
                (f.arriveAirport && f.arriveAirport.includes(params.airport))
            );
        }
        if (params.largeOnly) {
            const largeAircraftRegex = /330|350|777|787|747|380/i;
            resultFlights = resultFlights.filter(f => f.aircraft && largeAircraftRegex.test(f.aircraft));
        }

        // 更新 Cookie（搜索后可能有新的 session cookie）
        await saveCookies(page);

        output({
            success: true,
            status: 'found',
            query: {
                from: `${params.from}(${fromCode})`,
                to: `${params.to}(${toCode})`,
                date: params.date,
                cabin: params.cabin,
                time: params.time || '不限',
                airport: params.airport || '不限',
                largeOnly: params.largeOnly || false,
                directOnly: params.direct,
            },
            totalFlights: resultFlights.length,
            flights: resultFlights,
            screenshot: shotResult,
        });

    } catch (err) {
        outputError(`搜索失败: ${err.message}`, { stack: err.stack });
        if (browser) await browser.disconnect();
        process.exit(1);
    }
    // ⚠️ 不要 browser.close()
    if (browser) await browser.disconnect();
    process.exit(0);
}

main();
