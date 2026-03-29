const puppeteer = require('puppeteer-core');

async function test() {
    const browser = await puppeteer.connect({
        browserWSEndpoint: 'ws://localhost:9222',
        defaultViewport: { width: 1366, height: 768 }
    });
    const page = await browser.newPage();
    await page.goto('https://passport.ctrip.com/user/login', { waitUntil: 'networkidle2' });

    // 获取整个页面的 class
    const html = await page.evaluate(() => {
        const wrap = document.querySelector('.login-wrap, .login-box, body');
        return wrap ? wrap.innerHTML : '';
    });

    console.log(html);
    await browser.disconnect();
    process.exit(0);
}

test();
