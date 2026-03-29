const { connectBrowser, getPage, waitFor, screenshot } = require('./scripts/browser-utils.js');
const fs = require('fs');

async function debugLogin() {
    console.log('[DEBUG] Connecting to browser...');
    const browser = await connectBrowser();
    const page = await getPage(browser);

    console.log('[DEBUG] Current URL:', page.url());

    // Save screenshot of whatever the page is on right now
    await screenshot(page, 'debug_current_state');
    console.log(`[DEBUG] Saved screenshot of current state: /tmp/ctrip_debug_current_state_*.png`);

    // Refresh CTRIP_HOME
    console.log('[DEBUG] Navigating to www.ctrip.com with 10s timeout...');
    try {
        await page.goto('https://www.ctrip.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
        console.log('[DEBUG] Navigation to CTRIP_HOME successful.');
    } catch (e) {
        console.log('[DEBUG] Navigation timeout or error:', e.message);
    }
    await waitFor(2000);

    await screenshot(page, 'debug_after_goto');

    // Get all Puppeteer cookies
    const allCookies = await page.cookies();
    const ticketCookie = allCookies.find(c => c.name.toLowerCase().includes('ticket'));
    const duidCookie = allCookies.find(c => c.name === 'DUID');

    console.log('[DEBUG] Cookies via Puppeteer page.cookies():');
    console.log(' - cticket present?', !!ticketCookie, ticketCookie ? `(HttpOnly: ${ticketCookie.httpOnly}, Secure: ${ticketCookie.secure})` : '');
    console.log(' - DUID present?', !!duidCookie);
    console.log(` - Total cookies count: ${allCookies.length}`);

    // Get DOM document.cookie and user elements
    const domData = await page.evaluate(() => {
        const userEl = document.querySelector('.tl_nme, .lg_bt_username, [class*="avatar"], [class*="username"]');
        return {
            documentCookieSnippet: document.cookie.substring(0, 100) + '...',
            hasTicketInDocCookie: document.cookie.includes('cticket') || document.cookie.includes('Ticket'),
            hasDuidInDocCookie: document.cookie.includes('DUID'),
            userElText: userEl ? userEl.textContent.trim() : null,
            userElHtml: userEl ? userEl.outerHTML : null,
            bodyTextPreview: document.body.innerText.substring(0, 100).replace(/\n/g, ' '),
            hasLoginText: document.body.innerText.includes('登录') || document.body.innerText.includes('注册'),
            hasMyCtrip: document.body.innerText.includes('我的携程')
        };
    });

    console.log('[DEBUG] DOM Evaluation Data:');
    console.log(JSON.stringify(domData, null, 2));

    await browser.disconnect();
}

debugLogin().catch(console.error);
