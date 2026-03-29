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
        // 携程登录页通常有 "扫码登录" 选项
        const tabs = document.querySelectorAll('.tab-list li, .login-tab-item, [class*="qrcode"], [class*="scan"]');
        for (const tab of tabs) {
            if (tab.textContent.includes('扫码') || tab.textContent.includes('二维码')) {
                tab.click();
                return true;
            }
        }
        return false;
    });

    await waitFor(2000);

    // 4. 截图二维码
    const shotQR = await screenshot(page, 'qrcode');

    // 5. 等待用户扫码（轮询检查，最多 120 秒）
    output({
        success: true,
        status: 'waiting_scan',
        message: '请打开携程 APP 扫码登录',
        qrcode_screenshot: shotQR,
        login_page_screenshot: shotBefore,
        timeout: 120,
    });

    const startTime = Date.now();
    const SCAN_TIMEOUT = 120000; // 2 分钟

    while (Date.now() - startTime < SCAN_TIMEOUT) {
        await waitFor(3000);

        // 检查是否已跳转到首页（扫码成功后会自动跳转）
        const currentUrl = page.url();
        if (!currentUrl.includes('passport.ctrip.com') && !currentUrl.includes('login')) {
            // 登录成功
            const cookies = await saveCookies(page);
            const status = await checkLoginStatus(page);
            saveAuthState({
                loggedIn: true,
                username: status.username,
                loginMethod: 'qrcode',
                loginTime: new Date().toISOString(),
            });

            output({
                success: true,
                status: 'logged_in',
                username: status.username,
                cookies: cookies,
            });
            return true;
        }

        // 检查页面上是否显示了"已扫码"状态
        const scanState = await page.evaluate(() => {
            const body = document.body.innerText;
            if (body.includes('已扫码') || body.includes('确认登录')) {
                return 'scanned';
            }
            if (body.includes('二维码已过期') || body.includes('刷新')) {
                return 'expired';
            }
            return 'waiting';
        });

        if (scanState === 'expired') {
            // 刷新二维码
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitFor(2000);
            const newShot = await screenshot(page, 'qrcode_refresh');
            output({
                success: true,
                status: 'qr_refreshed',
                message: '二维码已过期，已刷新，请重新扫码',
                qrcode_screenshot: newShot,
            });
        }
    }

    // 超时
    const shotTimeout = await screenshot(page, 'login_timeout');
    outputError('扫码登录超时（2分钟）', { screenshot: shotTimeout });
    return false;
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
            // 仅检查状态
            const restoreResult = await tryRestoreSession(page);
            if (restoreResult.restored) {
                output({ success: true, status: 'logged_in', username: restoreResult.username });
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
