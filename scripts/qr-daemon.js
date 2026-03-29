const {
    connectBrowser, getPage, waitFor,
    screenshot, COOKIE_PATH, AUTH_PATH,
    saveAuthState
} = require('./browser-utils');
const CTRIP_LOGIN = 'https://passport.ctrip.com/user/login';
const fs = require('fs');

async function daemon() {
    let browser;
    try {
        browser = await connectBrowser();
        const page = await getPage(browser);
        await page.goto(CTRIP_LOGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitFor(2000);

        // Click QR tab
        await page.evaluate(() => {
            const tabs = document.querySelectorAll('.tab-list li, .login-tab-item, .login-code a, [class*="qrcode"], [class*="scan"]');
            for (const tab of tabs) {
                if (tab.textContent.includes('扫码') || tab.textContent.includes('二维码')) {
                    tab.click(); return;
                }
            }
            const allLinks = document.querySelectorAll('a, div, button, span');
            for (const el of allLinks) {
                if (el.textContent.trim() === '扫码登录' || el.textContent.trim() === '二维码登录') {
                    el.click(); return;
                }
            }
        });
        await waitFor(2000);

        // Screenshot QR code box
        const filepath = `/tmp/ctrip_qrcode_daemon_${Date.now()}.png`;
        const box = await page.$('.lg_loginwrap, .login-box, .content-box');
        if (box) await box.screenshot({ path: filepath });
        else await screenshot(page, 'qrcode_daemon');

        // Write a marker file so login.js knows QR is ready
        fs.writeFileSync('/tmp/ctrip_qr_ready.txt', filepath);

        // Passive polling for 180 seconds to detect native redirect
        for (let i = 0; i < 180; i++) {
            const currentUrl = page.url();
            if (!currentUrl.includes('passport.ctrip.com/user/login') && !currentUrl.includes('about:blank')) {
                // NATIVE REDIRECT HAPPENED! User scanned it!
                await waitFor(5000); // give cross-domain cookies time to drop

                const client = await page.target().createCDPSession();
                const { cookies } = await client.send('Network.getAllCookies');

                const dir = require('path').dirname(COOKIE_PATH);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));

                saveAuthState({
                    loggedIn: true,
                    username: 'User_Via_Daemon',
                    loginMethod: 'qrcode_daemon',
                    loginTime: new Date().toISOString(),
                });
                break; // Job done, cookies saved!
            }
            await waitFor(1000);
        }
    } catch (err) {
        console.error('[Daemon Error]', err);
    } finally {
        if (browser) await browser.disconnect();
        process.exit(0);
    }
}

daemon();
