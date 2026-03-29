#!/usr/bin/env node
/**
 * login.js — 携程登录脚本
 * 
 * 使用流程:
 *   node login.js                   # 自动尝试 Cookie 恢复，否则引导扫码
 *   node login.js --check           # 仅检查登录状态
 *   node login.js --qrcode          # 强制扫码登录
 *
 * 输出 JSON 到 stdout，供 Agent 读取
 */

const {
    connectBrowser, getPage, waitFor, waitForSelector,
    saveCookies, loadCookies, saveAuthState, loadAuthState,
    screenshot, output, outputError,
} = require('./browser-utils');

const CTRIP_HOME = 'https://www.ctrip.com';
const CTRIP_LOGIN = 'https://passport.ctrip.com/user/login';
const LOGIN_CHECK_TIMEOUT = 10000;

// ============================================================
//  检查登录状态
// ============================================================

async function checkLoginStatus(page) {
    try {
        await page.goto(CTRIP_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitFor(2000);

        // 检查是否有用户头像/昵称（已登录标志）
        const loggedIn = await page.evaluate(() => {
            // 携程首页登录后通常有 .tl_nme 或 .lg_bt_username 等元素
            const userEl = document.querySelector('.tl_nme, .lg_bt_username, [class*="avatar"], [class*="username"]');
            if (userEl && userEl.textContent.trim()) {
                return { loggedIn: true, username: userEl.textContent.trim() };
            }
            // 检查 cookie 中的登录态
            const hasCookie = document.cookie.includes('cticket') || document.cookie.includes('DUID');
            return { loggedIn: hasCookie, username: null };
        });

        return loggedIn;
    } catch (err) {
        return { loggedIn: false, error: err.message };
    }
}

// ============================================================
//  Cookie 恢复登录
// ============================================================

async function tryRestoreSession(page) {
    const loadResult = await loadCookies(page);
    if (!loadResult.success) {
        return { restored: false, reason: loadResult.error };
    }

    // 刷新页面检查登录态
    const status = await checkLoginStatus(page);
    if (status.loggedIn) {
        return { restored: true, username: status.username };
    }

    return { restored: false, reason: '旧 Cookie 已过期' };
}

// ============================================================
//  扫码登录
// ============================================================

async function qrcodeLogin(page) {
    // 1. 打开登录页
    await page.goto(CTRIP_LOGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(2000);

    // 2. 截图当前状态
    const shotBefore = await screenshot(page, 'login_page');

    // 3. 尝试切换到扫码登录 tab
    const qrTabFound = await page.evaluate(() => {
        const tabs = document.querySelectorAll('.tab-list li, .login-tab-item, .login-code a, [class*="qrcode"], [class*="scan"]');
        for (const tab of tabs) {
            if (tab.textContent.includes('扫码') || tab.textContent.includes('二维码')) {
                tab.click();
                return true;
            }
        }

        // 更暴力的 fallback：直接找包含"扫码"的所有链接
        const allLinks = document.querySelectorAll('a, div, button, span');
        for (const el of allLinks) {
            if (el.textContent.trim() === '扫码登录' || el.textContent.trim() === '二维码登录') {
                el.click();
                return true;
            }
        }

        return false;
    });

    await waitFor(2000);

    // 4. 截图二维码：只截取登录框部分，防止全屏截图导致微信上看不清二维码
    let shotQR;
    const box = await page.$('.lg_loginwrap, .login-box, .content-box');
    if (box) {
        const filename = `ctrip_qrcode_${Date.now()}.png`;
        const filepath = require('path').join('/tmp', filename);
        await box.screenshot({ path: filepath });
        shotQR = filepath;
    } else {
        shotQR = await screenshot(page, 'qrcode');
    }

    // 5. 立即返回二维码给 Agent，不阻塞进程
    output({
        success: true,
        status: 'waiting_scan',
        message: '请把此二维码发给用户，要求用户用携程 APP 扫码。',
        hint: '【极其重要】收到此状态后，必须立刻用 notify_user 工具把二维码发送给用户！等用户回复“扫好了”之后，再执行 node scripts/login.js --check',
        qrcode_screenshot: shotQR,
        login_page_screenshot: shotBefore,
    });
    return true;
}

// ============================================================
//  手机号登录（备用）
// ============================================================

async function phoneLogin(page, phone) {
    await page.goto(CTRIP_LOGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(2000);

    // 切换到手机号登录 tab
    await page.evaluate(() => {
        const tabs = document.querySelectorAll('.tab-list li, .login-tab-item');
        for (const tab of tabs) {
            if (tab.textContent.includes('手机') || tab.textContent.includes('账号')) {
                tab.click();
                return;
            }
        }
    });
    await waitFor(1000);

    // 输入手机号
    const phoneInput = await page.$('input[name="phone"], input[type="tel"], input[placeholder*="手机"]');
    if (phoneInput) {
        await phoneInput.click({ clickCount: 3 });
        await phoneInput.type(phone, { delay: 100 });
    }

    // 发送验证码
    const sendBtn = await page.$('button[class*="send"], button[class*="code"], [class*="sms-btn"]');
    if (sendBtn) {
        await sendBtn.click();
    }

    const shotSms = await screenshot(page, 'sms_sent');
    output({
        success: true,
        status: 'sms_sent',
        message: `验证码已发送到 ${phone}，请提供验证码`,
        screenshot: shotSms,
    });

    // 注意: 验证码需要 Agent 从用户获取后再调用完成登录
    return 'waiting_sms';
}

// ============================================================
//  主流程
// ============================================================

async function main() {
    const args = process.argv.slice(2);
    const mode = args[0] || '--auto';

    let browser;
    try {
        browser = await connectBrowser();
        const page = await getPage(browser);

        if (mode === '--check') {
            // 首先直接检查当前浏览器页面原生状态 (不覆盖 Cookie)
            let status = await checkLoginStatus(page);
            if (status.loggedIn) {
                // 如果发现已登录 (比如用户刚刚扫码完成)，立即抓取 Cookie 存起来
                const cookies = await saveCookies(page);
                saveAuthState({
                    loggedIn: true,
                    username: status.username,
                    loginMethod: 'qrcode_or_native',
                    loginTime: new Date().toISOString(),
                });
                output({ success: true, status: 'logged_in', username: status.username, cookies, method: 'native' });
                return;
            }

            // 如果原生未登录，尝试从文件恢复 Cookie
            const restoreResult = await tryRestoreSession(page);
            if (restoreResult.restored) {
                output({ success: true, status: 'logged_in', username: restoreResult.username, method: 'restored' });
            } else {
                const auth = loadAuthState();
                output({
                    success: true,
                    status: 'not_logged_in',
                    reason: restoreResult.reason,
                    lastAuth: auth,
                });
            }
            return;
        }

        if (mode === '--qrcode') {
            await qrcodeLogin(page);
            return;
        }

        if (mode === '--phone' && args[1]) {
            await phoneLogin(page, args[1]);
            return;
        }

        // --auto: 先尝试恢复，失败则扫码
        const restoreResult = await tryRestoreSession(page);
        if (restoreResult.restored) {
            output({
                success: true,
                status: 'logged_in',
                method: 'cookie_restore',
                username: restoreResult.username,
            });
            return;
        }

        // Cookie 恢复失败，引导扫码
        await qrcodeLogin(page);

    } catch (err) {
        outputError(`登录失败: ${err.message}`, { stack: err.stack });
        if (browser) await browser.disconnect();
        process.exit(1);
    }
    // ⚠️ 不要 browser.close()
    if (browser) await browser.disconnect();
    process.exit(0);
}

main();
