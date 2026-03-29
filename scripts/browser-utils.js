/**
 * browser-utils.js — 携程机票助手公共工具
 * 
 * 提供 CDP 连接、Cookie 管理、安全等待、截图等基础能力
 * 适配 OpenClaw Docker 环境约束
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// ============================================================
//  常量
// ============================================================

const CDP_URL = process.env.CHROME_CDP_URL || 'ws://openclaw-browser:9222';
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || '/home/node/.openclaw/workspace';
const COOKIE_PATH = path.join(WORKSPACE, 'ctrip_cookies.json');
const AUTH_DIR = path.join(WORKSPACE, '.auth');
const AUTH_PATH = path.join(AUTH_DIR, 'ctrip_auth.json');
const SCREENSHOT_DIR = '/tmp';

// ============================================================
//  浏览器连接
// ============================================================

/**
 * 通过 CDP 连接到共享浏览器实例
 * ⚠️ 绝对不能调用 browser.close()
 */
async function connectBrowser() {
    const browser = await puppeteer.connect({
        browserWSEndpoint: CDP_URL,
        defaultViewport: { width: 1366, height: 768 },
    });
    return browser;
}

/**
 * 获取一个可用的页面（优先复用已有标签页，否则新建）
 * ⚠️ 绝对不能调用 page.close()
 */
async function getPage(browser) {
    const pages = await browser.pages();
    // 复用空白页
    for (const p of pages) {
        const url = p.url();
        if (url === 'about:blank' || url === 'chrome://newtab/') {
            return p;
        }
    }
    // 没有空白页则新建
    return await browser.newPage();
}

// ============================================================
//  安全等待（替代 page.waitForTimeout）
// ============================================================

function waitFor(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待选择器出现，带超时
 */
async function waitForSelector(page, selector, timeout = 15000) {
    try {
        await page.waitForSelector(selector, { timeout });
        return true;
    } catch {
        return false;
    }
}

// ============================================================
//  Cookie 管理
// ============================================================

async function saveCookies(page) {
    try {
        const client = await page.target().createCDPSession();
        const { cookies } = await client.send('Network.getAllCookies');
        const dir = path.dirname(COOKIE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
        return { success: true, count: cookies.length, path: COOKIE_PATH };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function loadCookies(page) {
    try {
        if (!fs.existsSync(COOKIE_PATH)) {
            return { success: false, error: 'Cookie 文件不存在' };
        }
        const raw = fs.readFileSync(COOKIE_PATH, 'utf-8');
        const cookies = JSON.parse(raw);

        const client = await page.target().createCDPSession();
        await client.send('Network.setCookies', { cookies: cookies });

        return { success: true, loaded: cookies.length, total: cookies.length };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ============================================================
//  Auth 状态管理
// ============================================================

function saveAuthState(state) {
    try {
        if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
        const data = {
            ...state,
            updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2));
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function loadAuthState() {
    try {
        if (!fs.existsSync(AUTH_PATH)) return null;
        return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8'));
    } catch {
        return null;
    }
}

// ============================================================
//  截图
// ============================================================

async function screenshot(page, name) {
    const filename = `ctrip_${name}_${Date.now()}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: false });
    return filepath;
}

// ============================================================
//  输出工具
// ============================================================

/**
 * 标准化输出（JSON 到 stdout，供 Agent 读取）
 */
function output(data) {
    console.log(JSON.stringify(data, null, 2));
}

function outputError(message, details = {}) {
    output({ success: false, error: message, ...details });
}

// ============================================================
//  Exports
// ============================================================

module.exports = {
    CDP_URL,
    WORKSPACE,
    COOKIE_PATH,
    AUTH_PATH,
    SCREENSHOT_DIR,
    connectBrowser,
    getPage,
    waitFor,
    waitForSelector,
    saveCookies,
    loadCookies,
    saveAuthState,
    loadAuthState,
    screenshot,
    output,
    outputError,
};
