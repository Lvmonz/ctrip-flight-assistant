#!/usr/bin/env node
/**
 * confirm-order.js — 确认订单并跳转支付
 *
 * 流程:
 *   1. 勾选"我已阅读并同意 购票须知"
 *   2. 点击"去支付"
 *   3. 关闭保险弹窗（如有，选择"否"）
 *   4. 导航到订单页检查待支付订单
 *
 * 前置: 浏览器需停留在订单确认页面，乘机人已选择
 */

const {
    connectBrowser, getPage, waitFor, waitForSelector,
    saveCookies, screenshot, output, outputError,
} = require('./browser-utils');

async function main() {
    let browser;

    try {
        browser = await connectBrowser();
        const page = await getPage(browser);
        await waitFor(2000);

        output({ status: 'confirming', message: '正在确认订单...' });

        // 1. 勾选购票须知
        const agreed = await page.evaluate(() => {
            // 查找"我已阅读"相关的复选框
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
                if (el.textContent?.includes('我已阅读') && el.textContent.length < 200) {
                    // 找复选框
                    const checkbox = el.querySelector('input[type="checkbox"], [class*="checkbox"], [class*="check"]');
                    if (checkbox) { checkbox.click(); return 'checkbox'; }
                    el.click();
                    return 'element';
                }
            }
            // 尝试直接找 checkbox
            const checkboxes = document.querySelectorAll('input[type="checkbox"]');
            for (const cb of checkboxes) {
                const label = cb.closest('label, [class*="agree"]')?.textContent || '';
                if (label.includes('须知') || label.includes('同意') || label.includes('阅读')) {
                    cb.click();
                    return 'label-checkbox';
                }
            }
            return false;
        });
        if (agreed) {
            output({ status: 'agreed', message: '已勾选购票须知' });
        } else {
            output({ status: 'warning', message: '未找到购票须知复选框，可能已勾选' });
        }
        await waitFor(1000);

        // 2. 点击"去支付"
        const payClicked = await page.evaluate(() => {
            const allEls = document.querySelectorAll('button, [role="button"], a, [class*="btn"]');
            for (const el of allEls) {
                const text = el.textContent?.trim() || '';
                if (text === '去支付' || text.includes('去支付') || text.includes('提交订单')) {
                    el.click();
                    return text;
                }
            }
            return false;
        });

        if (payClicked) {
            output({ status: 'pay_clicked', message: `已点击: ${payClicked}` });
        } else {
            outputError('未找到"去支付"按钮');
            await screenshot(page, 'order_confirm_error');
            process.exit(1);
        }

        await waitFor(5000);

        // 3. 处理保险弹窗（如有）
        const dismissed = await page.evaluate(() => {
            // 查找弹窗中的"否"、"不需要"、"跳过" 等按钮
            const dismissTexts = ['否', '不需要', '跳过', '不了', '暂不需要', '关闭'];
            const allBtns = document.querySelectorAll('button, [role="button"], a, [class*="btn"]');
            for (const btn of allBtns) {
                const text = btn.textContent?.trim() || '';
                for (const dt of dismissTexts) {
                    if (text === dt || (text.includes(dt) && text.length < 20)) {
                        btn.click();
                        return text;
                    }
                }
            }
            // 查找关闭按钮（X）
            const closeBtn = document.querySelector('[class*="close"], [class*="modal"] [class*="close"]');
            if (closeBtn) { closeBtn.click(); return 'close-icon'; }
            return null;
        });

        if (dismissed) {
            output({ status: 'insurance_dismissed', message: `已关闭保险弹窗: ${dismissed}` });
            await waitFor(2000);
        }

        // 截图当前状态
        await screenshot(page, 'payment_page');
        await saveCookies(page);

        // 4. 检查当前页面状态
        const currentState = await page.evaluate(() => ({
            title: document.title,
            url: window.location.href,
            bodyText: document.body.innerText.substring(0, 2000),
        }));

        output({
            success: true,
            status: 'payment_ready',
            message: '订单已提交，请在携程 App 中完成支付',
            pageState: currentState,
        });

        // 5. 尝试导航到订单页验证
        output({ status: 'verifying', message: '正在跳转到订单页验证...' });
        await page.goto('https://my.ctrip.com/myinfo/flight', { waitUntil: 'networkidle2', timeout: 30000 });
        await waitFor(5000);

        const orderShot = await screenshot(page, 'order_verification');
        const orderInfo = await page.evaluate(() => ({
            title: document.title,
            url: window.location.href,
            bodyText: document.body.innerText.substring(0, 2000),
        }));

        output({
            success: true,
            status: 'verified',
            message: '已跳转到订单页面',
            orderPage: orderInfo,
            screenshot: orderShot,
        });

    } catch (err) {
        outputError(`确认订单失败: ${err.message}`, { stack: err.stack });
        if (browser) await browser.disconnect();
        process.exit(1);
    }

    if (browser) await browser.disconnect();
    process.exit(0);
}

main();
