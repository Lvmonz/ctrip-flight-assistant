const puppeteer = require('/home/node/.openclaw/skills/ctrip-flight/node_modules/puppeteer-core');
async function listPages() {
    console.log('[DEBUG] Connecting to browser...');
    const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://openclaw-browser:9222' });
    const pages = await browser.pages();
    console.log(`[DEBUG] Total Pages: ${pages.length}`);
    for (let i = 0; i < pages.length; i++) {
        console.log(`[Page ${i}] URL: ${pages[i].url()}`);
        console.log(`[Page ${i}] Title: ${await pages[i].title()}`);
    }
    await browser.disconnect();
}
listPages().catch(console.error);
