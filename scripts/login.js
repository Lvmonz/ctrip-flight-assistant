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
        // 安全地刷新状态。用短 timeout 避免遇广告卡死，哪怕 timeout 也强行继续查 DOM
        try {
            await page.goto(CTRIP_HOME, { waitUntil: 'domcontentloaded', timeout: 10000 });
        } catch (e) {
            // timeout 后直接忽略，因为可能页面其实已经加载出来了
        }
        await waitFor(2000);

        // 检查是否有用户头像/昵称（已登录标志）
        // 使用底层 CDP 获取全局全域 Cookie（无视当前域名限制和 HttpOnly 限制）
        const client = await page.target().createCDPSession();
        const { cookies } = await client.send('Network.getAllCookies');
        const hasTicket = cookies.some(c => c.name.toLowerCase().includes('ticket') || c.name === 'DUID');

        // 作为双重保险，也可以查 DOM（加 try-catch 防止页面正在跳转时报 Execution context destroyed 导致整个函数崩溃）
        let loggedInDOM = null;
        try {
            loggedInDOM = await page.evaluate(() => {
                const userEl = document.querySelector('.tl_nme, .lg_bt_username, [class*="avatar"], [class*="username"], [class*="user"], .head-portrait');
                if (userEl && userEl.textContent.trim() && !userEl.textContent.includes('登录') && !userEl.textContent.includes('注册')) {
                    return userEl.textContent.trim();
                }
                return null;
            });
        } catch (e) {
            console.log('[DEBUG] DOM evaluate 失败 (如果是执行上下文销毁可忽略):', e.message);
        }

        if (hasTicket || loggedInDOM) {
            return { loggedIn: true, username: loggedInDOM || 'User_Found_Via_Cookie' };
        }

        // 【致命调试环节】这说明验证又失败了！我们立刻截个图看看究竟为什么！
        await screenshot(page, 'check_fail_debug');

        return { loggedIn: false, error: 'No valid HttpOnly ctickets or user profile elements found' };
    } catch (err) {
        console.log('[DEBUG] checkLoginStatus 发生致命错误:', err.message);
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

async function qrcodeLogin() {
    const fs = require('fs');
    const { spawn } = require('child_process');
    const path = require('path');

    // Clean up old marker
    if (fs.existsSync('/tmp/ctrip_qr_ready.txt')) {
        fs.unlinkSync('/tmp/ctrip_qr_ready.txt');
    }

    // Spawn daemon!
    const daemonScript = path.join(__dirname, 'qr-daemon.js');
    const child = spawn('node', [daemonScript], { detached: true, stdio: 'ignore' });
    child.unref(); // Detach it so Node can exit cleanly while daemon holds CDP

    // Wait until daemon outputs the QR ready marker, up to 15 seconds
    let qrPath = null;
    for (let i = 0; i < 15; i++) {
        if (fs.existsSync('/tmp/ctrip_qr_ready.txt')) {
            qrPath = fs.readFileSync('/tmp/ctrip_qr_ready.txt', 'utf8').trim();
            break;
        }
        await waitFor(1000);
    }

    if (qrPath) {
        output({
            success: true,
            status: 'waiting_scan',
            message: '请把此二维码发给用户，要求用户用携程 APP 扫码。这是后台守护进程安全生成的。',
            hint: '【极其重要】收到此状态后，必须立刻用 notify_user 把二维码发给用户！等用户回复“扫好了”之后，再执行 node scripts/login.js --check',
            qrcode_screenshot: qrPath
        });
    } else {
        output({ success: false, error: '后台生成二维码超时或失败' });
    }
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
            // 给扫码后网页自行处理跨域 SSO 握手留一点时间
            // 循环检测当前 URL 是否已经脱离登录页，最多等 10 秒
            for (let i = 0; i < 10; i++) {
                const currentUrl = page.url();
                if (!currentUrl.includes('passport.ctrip.com/user/login')) {
                    // URL 已经发生变化，说明携程开始自动跳转了！
                    await waitFor(3000); // 给彻底写入 SSO 跨域 Cookies 留时间
                    break;
                }
                await waitFor(1000);
            }

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
            await qrcodeLogin();
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
        await qrcodeLogin();

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
