const puppeteer = require('/home/node/.openclaw/skills/ctrip-flight/node_modules/puppeteer-core');

async function dumpAll() {
    const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://openclaw-browser:9222' });
    const pages = await browser.pages();
    const page = pages.find(p => p.url().includes('ctrip.com')) || pages[0];

    console.log('[DEBUG] Current URL:', page.url());
    await page.screenshot({ path: '/tmp/final_debug.png' });

    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');

    console.log('[DEBUG] Total Cookies:', cookies.length);
    console.log('[DEBUG] All Cookie Names:', cookies.map(c => c.name).join(', '));

    const tickets = cookies.filter(c => c.name.toLowerCase().includes('ticket') || c.name === 'DUID');
    console.log('[DEBUG] Filtered Tickets:', tickets.map(c => c.name).join(', '));

    await browser.disconnect();
}
dumpAll().catch(console.error);
