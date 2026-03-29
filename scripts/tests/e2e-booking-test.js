#!/usr/bin/env node
/**
 * e2e-booking-test.js — 单会话完整预订测试
 * 
 * 在一个浏览器会话中完成:
 *   1. 导航到搜索页
 *   2. 点击"订票"展开 → 点击"预订"进入下单页
 *   3. 选择乘机人: 迟新祥
 *   4. 点击"下一步" → 到达确认页
 *   5. 点击"去支付" → 生成待支付订单
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CDP_URL = process.env.CHROME_CDP_URL || 'ws://openclaw-browser:9222';
const COOKIE_PATH = '/home/node/.openclaw/workspace/ctrip_cookies.json';

function log(step, msg) {
    console.log(`\n[${'STEP ' + step}] ${msg}`);
}

function output(data) {
    console.log(JSON.stringify(data, null, 2));
}

async function waitFor(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    const browser = await puppeteer.connect({
        browserWSEndpoint: CDP_URL,
        defaultViewport: { width: 1366, height: 768 },
    });

    // 获取一个可用页面
    const pages = await browser.pages();
    let page = pages.find(p => p.url() === 'about:blank' || p.url() === 'chrome://newtab/');
    if (!page) page = await browser.newPage();

    // 加载 Cookie
    if (fs.existsSync(COOKIE_PATH)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf-8'));
        const client = await page.target().createCDPSession();
        await client.send('Network.setCookies', { cookies });
    }

    try {
        // ============================================================
        // STEP 1: 导航到搜索页
        // ============================================================
        log(1, '导航到搜索页...');
        await page.goto(
            'https://flights.ctrip.com/online/list/oneway-HGH-BJS?depdate=2026-03-30&cabin=y_s_c_f&adult=1&child=0&infant=0',
            { waitUntil: 'networkidle2', timeout: 45000 }
        );
        await waitFor(10000);

        // 等待航班卡片
        await page.waitForSelector('.flight-item', { timeout: 15000 });
        const flightCount = await page.evaluate(() =>
            document.querySelectorAll('.flight-item').length
        );
        log(1, `✅ 搜索页加载完成，${flightCount} 个航班`);

        // ============================================================
        // STEP 2: 点击第一个航班的"订票" → 展开 → 点击"预订"
        // ============================================================
        log(2, '点击第一个航班的"订票"按钮...');
        const bookBtns = await page.$$('.btn-book');
        await bookBtns[0].click();
        await waitFor(3000);

        // 获取航班信息
        const flightInfo = await page.evaluate(() => {
            const item = document.querySelector('.flight-item');
            return {
                airline: item?.querySelector('.flight-airline .airline-name span')?.textContent?.trim() || '',
                flightNo: (item?.querySelector('.plane-No')?.textContent?.trim() || '').match(/^([A-Z\d]+)/)?.[1] || '',
            };
        });
        log(2, `✅ 已展开 ${flightInfo.flightNo} ${flightInfo.airline}`);

        // 点击"预订"按钮（不是"订票"也不是"收起"）
        log(2, '点击"预订"按钮...');
        const clickedBook = await page.evaluate(() => {
            const firstItem = document.querySelector('.flight-item');
            if (!firstItem) return false;
            const btns = Array.from(firstItem.querySelectorAll('.btn-book')).filter(b => {
                const text = b.textContent.trim();
                return text === '预订' || text === '选购';
            });
            if (btns[0]) { btns[0].click(); return btns[0].textContent.trim(); }
            return false;
        });
        log(2, `✅ 已点击: ${clickedBook}`);

        // 等待页面跳转到下单页
        await waitFor(3000);
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        } catch { }
        await waitFor(5000);

        const orderUrl = page.url();
        log(2, `✅ 进入下单页: ${orderUrl}`);
        await page.screenshot({ path: '/tmp/e2e_order_page.png' });

        // ============================================================
        // STEP 3: 选择乘机人 "迟新祥"
        // ============================================================
        log(3, '选择乘机人: 迟新祥');

        // 先看看页面上的乘机人列表
        const passengerInfo = await page.evaluate(() => {
            const text = document.body.innerText;
            const hasTarget = text.includes('迟新祥');
            // 查找所有看起来像乘机人名字的元素
            const nameEls = [];
            document.querySelectorAll('*').forEach(el => {
                if (el.children.length === 0 && el.textContent?.trim() === '迟新祥') {
                    nameEls.push({
                        tag: el.tagName,
                        class: el.className?.substring(0, 100) || '',
                        parent: el.parentElement?.className?.substring(0, 100) || '',
                        grandparent: el.parentElement?.parentElement?.className?.substring(0, 100) || '',
                    });
                }
            });
            return { hasTarget, nameEls };
        });

        log(3, `页面包含"迟新祥": ${passengerInfo.hasTarget}`);
        if (passengerInfo.nameEls.length > 0) {
            log(3, `找到 ${passengerInfo.nameEls.length} 个匹配元素:`);
            output(passengerInfo.nameEls);
        }

        // 点击"迟新祥"
        const clicked = await page.evaluate(() => {
            // 策略 1: 查找精确匹配的文字元素并点击
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
                if (el.children.length <= 2 && el.textContent?.trim() === '迟新祥') {
                    el.click();
                    return { method: 'exact-text-click', tag: el.tagName, class: el.className };
                }
            }
            // 策略 2: 查找包含该名字的行并点击
            for (const el of allEls) {
                if (el.textContent?.includes('迟新祥') && el.textContent.length < 30) {
                    el.click();
                    return { method: 'contains-click', tag: el.tagName };
                }
            }
            return false;
        });

        if (clicked) {
            log(3, `✅ 已点击乘机人: ${JSON.stringify(clicked)}`);
        } else {
            log(3, '❌ 未找到乘机人元素');
        }
        await waitFor(2000);
        await page.screenshot({ path: '/tmp/e2e_passenger_selected.png' });

        // 检查是否需要填手机号
        const needsPhone = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input');
            for (const input of inputs) {
                const ph = input.placeholder || '';
                if (ph.includes('手机') || ph.includes('电话')) {
                    return { placeholder: ph, value: input.value, hasValue: !!input.value };
                }
            }
            return null;
        });

        if (needsPhone && !needsPhone.hasValue) {
            log(3, '填写手机号: 18320949762');
            await page.evaluate(() => {
                const inputs = document.querySelectorAll('input');
                for (const input of inputs) {
                    const ph = input.placeholder || '';
                    if (ph.includes('手机') || ph.includes('电话')) {
                        input.focus();
                        input.value = '18320949762';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        return;
                    }
                }
            });
            await waitFor(1000);
        }

        // ============================================================
        // STEP 4: 点击"下一步"
        // ============================================================
        log(4, '点击"下一步"...');
        const nextClicked = await page.evaluate(() => {
            const allEls = document.querySelectorAll('button, [role="button"], a, [class*="btn"], div');
            for (const el of allEls) {
                const text = el.textContent?.trim() || '';
                if (text === '下一步' && el.offsetParent !== null) {
                    el.click();
                    return true;
                }
            }
            return false;
        });

        if (nextClicked) {
            log(4, '✅ 已点击"下一步"');
        } else {
            log(4, '⚠️ 未找到"下一步"按钮');
        }

        await waitFor(5000);
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        } catch { }
        await waitFor(3000);

        const pageAfterNext = page.url();
        log(4, `当前页面: ${pageAfterNext}`);
        await page.screenshot({ path: '/tmp/e2e_after_next.png' });

        // 获取当前页面内容摘要
        const pageText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
        log(4, `页面内容预览:\n${pageText.substring(0, 500)}`);

        // ============================================================
        // STEP 5: 勾选购票须知 + 点击"去支付"
        // ============================================================
        log(5, '勾选购票须知...');

        // 勾选同意
        const agreed = await page.evaluate(() => {
            // 找"我已阅读"复选框
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
                if (el.textContent?.includes('我已阅读') && el.textContent?.includes('同意') && el.textContent.length < 300) {
                    const checkbox = el.querySelector('input[type="checkbox"], [class*="checkbox"], [class*="check"]');
                    if (checkbox) { checkbox.click(); return 'checkbox'; }
                    // 可能没有 checkbox，整个区域可点击
                    el.click();
                    return 'area-click';
                }
            }
            return false;
        });
        log(5, `购票须知: ${agreed || '未找到（可能在下一步页面）'}`);
        await waitFor(1000);

        // 点击"去支付"
        log(5, '点击"去支付"...');
        const payClicked = await page.evaluate(() => {
            const allEls = document.querySelectorAll('button, [role="button"], a, [class*="btn"], div, span');
            for (const el of allEls) {
                const text = el.textContent?.trim() || '';
                if ((text === '去支付' || text.includes('去支付') || text === '提交订单')
                    && el.offsetParent !== null && text.length < 20) {
                    el.click();
                    return text;
                }
            }
            return false;
        });

        if (payClicked) {
            log(5, `✅ 已点击: ${payClicked}`);
        } else {
            log(5, '⚠️ 未找到"去支付"按钮（可能需要先完成上一步）');
        }

        await waitFor(5000);

        // 处理保险弹窗
        const dismissed = await page.evaluate(() => {
            const dismissTexts = ['否', '不需要', '跳过', '不了', '暂不需要', '关闭', '我知道了', '不用了'];
            const allBtns = document.querySelectorAll('button, [role="button"], a, [class*="btn"], div, span');
            for (const btn of allBtns) {
                const text = btn.textContent?.trim() || '';
                for (const dt of dismissTexts) {
                    if (text === dt && btn.offsetParent !== null && text.length < 20) {
                        btn.click();
                        return text;
                    }
                }
            }
            return null;
        });

        if (dismissed) {
            log(5, `关闭弹窗: ${dismissed}`);
            await waitFor(3000);
        }

        await page.screenshot({ path: '/tmp/e2e_payment.png' });

        // 获取最终页面状态
        const finalUrl = page.url();
        const finalText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
        const finalTitle = await page.evaluate(() => document.title);

        log(5, `最终页面 URL: ${finalUrl}`);
        log(5, `最终页面标题: ${finalTitle}`);

        // ============================================================
        //  📊 FINAL REPORT
        // ============================================================
        console.log('\n' + '═'.repeat(60));
        console.log('  📊 完整预订流程测试报告');
        console.log('═'.repeat(60));

        output({
            testTime: new Date().toISOString(),
            results: {
                step1_search: { status: 'PASS', flights: flightCount },
                step2_book: { status: clickedBook ? 'PASS' : 'FAIL', clicked: clickedBook, url: orderUrl },
                step3_passenger: { status: clicked ? 'PASS' : 'FAIL', clicked },
                step4_next: { status: nextClicked ? 'PASS' : 'WARN', url: pageAfterNext },
                step5_pay: { status: payClicked ? 'PASS' : 'WARN', clicked: payClicked, dismissed },
            },
            finalState: {
                url: finalUrl,
                title: finalTitle,
                textPreview: finalText.substring(0, 500),
            },
            screenshots: {
                orderPage: '/tmp/e2e_order_page.png',
                passengerSelected: '/tmp/e2e_passenger_selected.png',
                afterNext: '/tmp/e2e_after_next.png',
                payment: '/tmp/e2e_payment.png',
            },
        });

    } catch (err) {
        console.error(`\n💥 ERROR: ${err.message}`);
        await page.screenshot({ path: '/tmp/e2e_error.png' }).catch(() => { });
        output({ error: err.message, stack: err.stack });
    }

    await browser.disconnect();
    process.exit(0);
}

main();
