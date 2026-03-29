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
            case '--airline': params.airline = args[++i]; break;
            case '--maxPrice': params.maxPrice = parseInt(args[++i], 10); break;
            case '--sort': params.sort = args[++i]; break; // price | time | duration
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
    // 携程国内航班搜索 URL 格式 (移除 adult/child/infant 参数防止触发严格风控导致无法下拉加载)
    return `https://flights.ctrip.com/online/list/oneway-${from}-${to}?depdate=${date}&cabin=${cabinParam}`;
}

// ============================================================
//  解析航班列表（基于真实携程 DOM 结构 2026-03 验证）
//
//  DOM 层级：
//    div.flight-item.domestic
//      └─ div.flight-box
//           └─ div.flight-row
//                ├─ div.flight-airline  → 航司 + 航班号 + 机型
//                ├─ div.flight-detail
//                │    ├─ div.depart-box → 出发时间 + 机场
//                │    ├─ div.arrow-box  → 经停/直飞
//                │    └─ div.arrive-box → 到达时间 + 机场
//                └─ div.flight-operate
//                     └─ div.flight-price → 价格
// ============================================================

async function parseFlightList(page) {
    return await page.evaluate(() => {
        const flights = [];
        const cards = document.querySelectorAll('.flight-item');

        for (const card of cards) {
            try {
                // 航司名称
                const airlineEl = card.querySelector('.flight-airline .airline-name span');
                // 航班号 + 机型（格式: "JD5907 空客A320(中)"）
                const planeNoEl = card.querySelector('.plane-No');
                // 出发时间
                const depTimeEl = card.querySelector('.depart-box .time');
                // 到达时间
                const arrTimeEl = card.querySelector('.arrive-box .time');
                // 出发机场名
                const depAirportNameEl = card.querySelector('.depart-box .airport .name');
                const depTerminalEl = card.querySelector('.depart-box .airport .terminal');
                // 到达机场名
                const arrAirportNameEl = card.querySelector('.arrive-box .airport .name');
                const arrTerminalEl = card.querySelector('.arrive-box .airport .terminal');
                // 价格（<dfn>¥</dfn>430 结构）
                const priceContainer = card.querySelector('.flight-price .price');
                // 经停信息（arrow-box 内的 transfer-text）
                const transferEl = card.querySelector('.arrow-box [id^="transfer-text-"]');
                // 舱位折扣
                const subPriceEl = card.querySelector('.sub-price-item');
                // 标签（如"当日低价"、"宠物友好"）
                const tagEls = card.querySelectorAll('.flight-tags .tag');

                // 解析航班号和机型
                const planeNoText = planeNoEl?.textContent?.trim() || '';
                const flightNoMatch = planeNoText.match(/^([A-Z\d]{4,8})/);
                const aircraftMatch = planeNoText.match(/([^\s]+\(.+?\))$/);

                // 解析价格数字
                let priceText = '';
                if (priceContainer) {
                    const dfn = priceContainer.querySelector('dfn');
                    const priceNum = priceContainer.textContent?.replace(/[¥起\s]/g, '').trim();
                    priceText = dfn ? `¥${priceNum}` : priceContainer.textContent?.trim() || '';
                }

                // 解析到达时间（可能带 "+1天" 等后缀）
                let arriveTime = '';
                if (arrTimeEl) {
                    const mainTime = arrTimeEl.childNodes[0]?.textContent?.trim() || '';
                    const dayEl = arrTimeEl.querySelector('.day');
                    const daySuffix = dayEl?.textContent?.trim() || '';
                    arriveTime = mainTime + (daySuffix ? ` ${daySuffix}` : '');
                }

                // 组合机场信息
                const depAirport = (depAirportNameEl?.textContent?.trim() || '') +
                    (depTerminalEl?.textContent?.trim() || '');
                const arrAirport = (arrAirportNameEl?.textContent?.trim() || '') +
                    (arrTerminalEl?.textContent?.trim() || '');

                // 经停信息
                const transferText = transferEl?.textContent?.trim() || '';
                const stops = transferText || '直飞';

                const flight = {
                    airline: airlineEl?.textContent?.trim() || '',
                    flightNo: flightNoMatch ? flightNoMatch[1] : '',
                    departTime: depTimeEl?.textContent?.trim() || '',
                    arriveTime: arriveTime.trim(),
                    departAirport: depAirport,
                    arriveAirport: arrAirport,
                    price: priceText,
                    stops,
                    aircraft: aircraftMatch ? aircraftMatch[1] : '',
                    cabinDiscount: subPriceEl?.textContent?.trim() || '',
                    tags: Array.from(tagEls).map(t => t.textContent.trim()).filter(Boolean),
                };

                // 至少有航班号或出发时间才算有效
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
 * 备用解析：使用 innerText 按航班行分段提取
 */
async function parseFlightListFallback(page) {
    return await page.evaluate(() => {
        const text = document.body.innerText;
        // 检查是否有"无航班"提示
        if (text.includes('没有找到') || text.includes('无航班') || text.includes('暂无')) {
            return { noResult: true, message: '未找到符合条件的航班' };
        }

        // 尝试用 .flight-item 的 innerText 逐段提取
        const items = document.querySelectorAll('.flight-item');
        if (items.length > 0) {
            const rawFlights = Array.from(items).map(el => el.innerText.replace(/\n+/g, ' | '));
            return { rawLines: rawFlights.slice(0, 30) };
        }

        // 最终降级：从全页文字中提取航班相关行
        const lines = text.split('\n').filter(l => l.trim());
        const flightLines = lines.filter(l =>
            /\d{1,2}:\d{2}/.test(l) ||
            /[A-Z]{2}\d{3,4}/.test(l) ||
            /¥/.test(l) ||
            /经停|直飞|中转/.test(l)
        );
        return { rawLines: flightLines.slice(0, 50) };
    });
}

// ============================================================
//  滚动加载全量航班
// ============================================================

async function scrollToLoadAll(page) {
    // 强制盲目滚动并移动鼠标，确保触发懒加载
    // 很多现代站点网络请求耗时可能大于 2 秒，如果太早 break 会导致只看到前 15 条
    const SCROLL_AMOUNT = 30;

    // 把鼠标移动到安全区域（左上角），防止停留在悬浮栏或广告上拦截滚动事件
    await page.mouse.move(150, 200);
    // 必须点击一次，确保页面在容器中获得焦点，否则 wheel 事件会被浏览器忽略！
    await page.mouse.click(150, 200);

    for (let i = 0; i < SCROLL_AMOUNT; i++) {
        await page.mouse.wheel({ deltaY: 500 });
        // 加入轻微抖动防止反爬虫判断
        await page.mouse.move(100 + Math.random() * 100, 100 + Math.random() * 100);
        await waitFor(500); // 每次滚动后稍等
    }

    // 给最后一次懒加载多留一点时间渲染
    await waitFor(3000);

    const currentCount = await page.evaluate(() =>
        document.querySelectorAll('.flight-item').length
    );

    // 滚回顶部
    await page.evaluate(() => window.scrollTo(0, 0));
    return currentCount;
}

// ============================================================
//  价格解析工具
// ============================================================

function parsePriceNum(priceStr) {
    if (!priceStr) return Infinity;
    const m = priceStr.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : Infinity;
}

function calcMinutes(dep, arr) {
    if (!dep || !arr) return Infinity;
    const [dh, dm] = dep.split(':').map(Number);
    const arrClean = arr.replace(/\s*\+.*$/, ''); // 去掉 "+1天"
    const [ah, am] = arrClean.split(':').map(Number);
    let diff = (ah * 60 + am) - (dh * 60 + dm);
    if (diff <= 0) diff += 24 * 60; // 跨天
    return diff;
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

        // 导航到搜索页（使用 networkidle2 等待 AJAX 航班数据加载）
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 45000 });

        // 等待航班列表渲染（React 客户端渲染需要额外时间）
        await waitFor(8000);

        // 等待航班卡片出现
        const hasCards = await waitForSelector(page, '.flight-item', 15000);

        // 滚动加载全量航班
        if (hasCards) {
            const totalLoaded = await scrollToLoadAll(page);
            output({ status: 'loaded', message: `已加载 ${totalLoaded} 条航班，正在解析...` });
        }

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

        // ========== 内存过滤 ==========
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
        if (params.airline) {
            resultFlights = resultFlights.filter(f =>
                f.airline && f.airline.includes(params.airline)
            );
        }
        if (params.maxPrice) {
            resultFlights = resultFlights.filter(f => parsePriceNum(f.price) <= params.maxPrice);
        }

        // ========== 排序 ==========
        if (params.sort) {
            switch (params.sort) {
                case 'price':
                    resultFlights.sort((a, b) => parsePriceNum(a.price) - parsePriceNum(b.price));
                    break;
                case 'time':
                    resultFlights.sort((a, b) => (a.departTime || '').localeCompare(b.departTime || ''));
                    break;
                case 'duration':
                    // 按飞行时长排（到达-出发）
                    resultFlights.sort((a, b) => {
                        const dA = calcMinutes(a.departTime, a.arriveTime);
                        const dB = calcMinutes(b.departTime, b.arriveTime);
                        return dA - dB;
                    });
                    break;
            }
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
                airline: params.airline || '不限',
                maxPrice: params.maxPrice || '不限',
                sort: params.sort || 'default',
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
