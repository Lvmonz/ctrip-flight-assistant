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
        await page.goto(CTRIP_LOGIN, { waitUntil: 'networkidle2', timeout: 30000 });
        await waitFor(3000);

        // Click QR tab — the actual selector is `.login-code a`
        await page.evaluate(() => {
            // Primary: the known working selector
            const link = document.querySelector('.login-code a');
            if (link && link.textContent.includes('扫码')) {
                link.click(); return;
            }
            // Fallback: search for any element with "扫码登录" text
            const allEls = document.querySelectorAll('a, div, button, span');
            for (const el of allEls) {
                const text = el.textContent.trim();
                if (text === '扫码登录' || text === '二维码登录') {
                    el.click(); return;
                }
            }
        });
        await waitFor(5000); // QR code renders as <canvas>, needs time

        // Verify QR canvas exists
        const hasQR = await page.evaluate(() => {
            const canvas = document.querySelector('.qrcode-box canvas, [data-testid="qrCodeBox"] canvas');
            return canvas ? { w: canvas.width, h: canvas.height } : null;
        });

        // Screenshot the login box (contains QR code + instructions)
        const filepath = `/tmp/ctrip_qrcode_daemon_${Date.now()}.png`;
        const box = await page.$('#bbz_accounts_pc_lg_box') || await page.$('.lg_loginwrap');
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
