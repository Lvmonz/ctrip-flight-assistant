#!/usr/bin/env node
/**
 * select-passenger.js — 选择或新增乘机人
 *
 * 使用方式:
 *   node select-passenger.js --select "张三,李四"
 *   node select-passenger.js --add --name "王五" --idcard "320xxx" --phone "138xxx"
 *
 * 前置: 浏览器需停留在下单页面
 */

const {
    connectBrowser, getPage, waitFor, waitForSelector,
    screenshot, output, outputError,
} = require('./browser-utils');

function parseArgs() {
    const args = process.argv.slice(2);
    const params = {};
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--select': params.select = args[++i]; break;
            case '--add': params.add = true; break;
            case '--name': params.name = args[++i]; break;
            case '--idcard': params.idcard = args[++i]; break;
            case '--phone': params.phone = args[++i]; break;
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
        await waitFor(2000);

        if (params.select) {
            // 选择已有乘机人
            const names = params.select.split(',').map(n => n.trim());
            output({ status: 'selecting', message: `正在选择乘机人: ${names.join(', ')}` });

            for (const name of names) {
                const clicked = await page.evaluate((targetName) => {
                    // 查找包含该姓名的元素并点击
                    const allEls = document.querySelectorAll('*');
                    for (const el of allEls) {
                        if (el.children.length <= 3 && el.textContent?.trim() === targetName) {
                            el.click();
                            return true;
                        }
                    }
                    // 备选：查找包含姓名的行并点击复选框
                    for (const el of allEls) {
                        if (el.textContent?.includes(targetName) && el.textContent.length < 50) {
                            const checkbox = el.querySelector('input[type="checkbox"], [class*="checkbox"]');
                            if (checkbox) { checkbox.click(); return true; }
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }, name);

                if (clicked) {
                    output({ status: 'selected', message: `已选择乘机人: ${name}` });
                } else {
                    output({ status: 'warning', message: `未找到乘机人: ${name}` });
                }
                await waitFor(1000);
            }
        }

        if (params.add) {
            // 新增乘机人
            if (!params.name || !params.idcard || !params.phone) {
                outputError('新增乘机人需要 --name, --idcard, --phone');
                process.exit(1);
            }

            output({ status: 'adding', message: `正在新增乘机人: ${params.name}` });

            // 点击"新增乘机人"
            await page.evaluate(() => {
                const allEls = document.querySelectorAll('*');
                for (const el of allEls) {
                    if (el.textContent?.includes('新增乘机人') && el.textContent.length < 20) {
                        el.click();
                        return true;
                    }
                }
                return false;
            });
            await waitFor(2000);

            // 填写表单（通过文字定位输入框）
            // 姓名
            await page.evaluate((name) => {
                const inputs = document.querySelectorAll('input');
                for (const input of inputs) {
                    const placeholder = input.placeholder || '';
                    const label = input.closest('label, [class*="form"]')?.textContent || '';
                    if (placeholder.includes('姓名') || label.includes('姓名')) {
                        input.focus();
                        input.value = name;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        return;
                    }
                }
                // 降级：尝试第一个空输入框
                for (const input of inputs) {
                    if (!input.value && input.type !== 'hidden') {
                        input.focus();
                        input.value = name;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        return;
                    }
                }
            }, params.name);
            await waitFor(500);

            // 身份证
            await page.evaluate((idcard) => {
                const inputs = document.querySelectorAll('input');
                for (const input of inputs) {
                    const placeholder = input.placeholder || '';
                    const label = input.closest('label, [class*="form"]')?.textContent || '';
                    if (placeholder.includes('身份证') || placeholder.includes('证件号') || label.includes('证件')) {
                        input.focus();
                        input.value = idcard;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        return;
                    }
                }
            }, params.idcard);
            await waitFor(500);

            // 手机号
            await page.evaluate((phone) => {
                const inputs = document.querySelectorAll('input');
                for (const input of inputs) {
                    const placeholder = input.placeholder || '';
                    const label = input.closest('label, [class*="form"]')?.textContent || '';
                    if (placeholder.includes('手机') || placeholder.includes('电话') || label.includes('手机')) {
                        input.focus();
                        input.value = phone;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        return;
                    }
                }
            }, params.phone);
            await waitFor(500);
        }

        await screenshot(page, 'passenger_selection');

        // 获取当前选择状态
        const currentState = await page.evaluate(() => {
            return {
                title: document.title,
                url: window.location.href,
                bodyText: document.body.innerText.substring(0, 1500),
            };
        });

        output({
            success: true,
            status: 'done',
            pageState: currentState,
            hint: '确认乘机人后，使用 confirm-order.js 完成支付',
        });

    } catch (err) {
        outputError(`乘机人操作失败: ${err.message}`, { stack: err.stack });
        if (browser) await browser.disconnect();
        process.exit(1);
    }

    if (browser) await browser.disconnect();
    process.exit(0);
}

main();
