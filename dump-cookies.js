const puppeteer = require('/home/node/.openclaw/skills/ctrip-flight/node_modules/puppeteer-core');
async function dumpAllCookies() {
    const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://openclaw-browser:9222' });
    const pages = await browser.pages();
    const page = pages.find(p => p.url().includes('ctrip.com')) || pages[0];

    console.log('[DEBUG] Connected to page:', page.url());

    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');

    console.log('[DEBUG] Total Cookies:', cookies.length);
    console.log('[DEBUG] Cookie Names:', cookies.map(c => c.name).join(', '));

    const ticketCookie = cookies.find(c => c.name.toLowerCase().includes('ticket'));
    const duidCookie = cookies.find(c => c.name === 'DUID');

    console.log('[DEBUG] ticketCookie:', ticketCookie ? ticketCookie.value : 'NOT FOUND');
    console.log('[DEBUG] duidCookie:', duidCookie ? duidCookie.value : 'NOT FOUND');

    await browser.disconnect();
}
dumpAllCookies().catch(console.error);
