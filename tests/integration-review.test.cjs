// Run with: node --test tests/frontend-security.test.cjs
// These isolated DOM/Chrome doubles never contact the production API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourceRoot = process.env.FRONTEND_SOURCE_ROOT || path.join(__dirname, '..');
const attack = '<img src=x onerror="alert(1)">';

class Element {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.children = [];
        this.style = {};
        this.listeners = new Map();
        this._value = '';
        this.className = '';
        this.disabled = false;
        this._text = '';
        const classes = new Set();
        this.classList = {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
            toggle: name => classes.has(name) ? classes.delete(name) : classes.add(name)
        };
    }
    set value(value) {
        // Native range inputs clamp custom values below min, unlike text inputs.
        this._value = this.type === 'range'
            ? String(Math.min(Number(this.max), Math.max(Number(this.min), Number(value))))
            : String(value);
    }
    get value() { return this._value; }
    set textContent(value) {
        this._text = String(value);
        this.children = [];
    }
    get textContent() {
        return this._text + this.children.map(child => child.textContent).join('');
    }
    set innerText(value) { this.textContent = value; }
    get innerText() { return this.textContent; }
    set innerHTML(value) {
        // Only the speed badge uses trusted, constant SVG markup.
        if (this.id === 'speedValue') {
            this.textContent = value.replace(/<svg[\s\S]*<\/svg>/, '').trim();
            return;
        }
        // Fail any tested render path that sends markup to the HTML parser.
        if (value !== '') throw new Error('Unsafe HTML parsing in external-data render path');
        this.replaceChildren();
    }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this._text = ''; this.children = children; }
    addEventListener(name, callback) {
        const callbacks = this.listeners.get(name) || [];
        callbacks.push(callback);
        this.listeners.set(name, callbacks);
    }
    async dispatch(name, event = {}) {
        await Promise.all((this.listeners.get(name) || []).map(fn => fn.call(this, event)));
    }
    async click(event = { target: this }) {
        if (this.disabled) return;
        if (this.onclick) await this.onclick(event);
        await this.dispatch('click', event);
    }
}

function app(kind, options = {}) {
    const elements = new Map();
    const ready = [];
    const windowListeners = new Map();
    const timers = new Map();
    let timerId = 0;
    const storage = new Map();
    const calls = [];
    const savedExtensionStates = [];
    const alerts = [];
    const videos = [
        { id: 'abcdefghijk', title: 'First video', thumbnail: 'https://i.ytimg.com/a.jpg', duration: 'PT10M' },
        { id: 'lmnopqrstuv', title: 'Second video', thumbnail: 'https://i.ytimg.com/b.jpg', duration: 'PT5M' }
    ];
    const get = id => {
        if (!elements.has(id)) {
            const element = new Element();
            element.id = id;
            elements.set(id, element);
        }
        return elements.get(id);
    };
    Object.assign(get('speedRange'), { type: 'range', min: '1', max: '5', value: '1' });
    const context = vm.createContext({
        Date: options.Date || Date, URL, AbortController, DOMException,
        setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
        clearTimeout: id => timers.delete(id),
        window: { addEventListener: (name, callback) => windowListeners.set(name, callback) },
        console: { error: options.onError || (error => { throw error; }) },
        alert: value => alerts.push(value),
        document: {
            getElementById: get,
            createElement: tag => new Element(tag),
            addEventListener: (name, callback) => {
                if (name === 'DOMContentLoaded') ready.push(callback);
            }
        },
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        },
        chrome: {
            tabs: { query: (_options, callback) => callback([{ url: options.tabUrl || 'https://www.youtube.com/playlist?list=PLtest123' }]) },
            storage: { local: {
                get: (_keys, callback) => callback(options.savedState || {}),
                set: state => savedExtensionStates.push(state)
            } }
        },
        fetch: async (url, init) => {
            calls.push(url);
            if (options.fetch) return options.fetch(url, init);
            return { ok: true, json: async () => ({ total_videos: videos.length, videos }) };
        }
    });
    vm.runInContext(fs.readFileSync(path.join(sourceRoot, 'extension/calculation-request.js'), 'utf8'), context);
    const file = kind === 'web' ? 'script.js' : 'extension/popup.js';
    vm.runInContext(fs.readFileSync(path.join(sourceRoot, file), 'utf8'), context, { filename: file });
    return {
        get, storage, calls, alerts, savedExtensionStates, timers,
        leave: () => windowListeners.get('pagehide')(),
        run: code => vm.runInContext(code, context),
        ready: async () => { for (const callback of ready) await callback(); }
    };
}


for (const kind of ['web', 'extension']) {
    for (const stop of ['cancel', 'timeout']) {
        test(`${kind}: positions/index survive ${stop}, pagination error and retry`, async () => {
            const url = 'https://www.youtube.com/playlist?list=PLtest123&index=3';
            const videos = [
                { id: 'abcdefghijk', title: 'Repeated', duration: 'PT10M', position: 1 },
                { id: 'lmnopqrstuv', title: 'Third', duration: 'PT5M', position: 3 },
                { id: 'abcdefghijk', title: 'Repeated', duration: 'PT10M', position: 4 }
            ];
            const response = () => ({ ok: true, json: async () => ({ videos }) });
            let calls = 0;
            let late;
            const a = app(kind, { tabUrl: url, fetch: async () => {
                calls++;
                if (calls === 2) return new Promise(resolve => { late = resolve; });
                if (calls === 3) return { ok: false, json: async () => ({ detail: 'YouTube returned an invalid response. Please try again.' }) };
                return response();
            }});
            await a.ready();
            if (kind === 'web') a.get('playlistUrl').value = url;
            const btn = a.get('calcBtn');
            const verify = () => {
                assert.equal(a.run('totalSecondsGlobal'), 900);
                assert.deepEqual(Array.from(a.run('videoDataList.map(v => v.active)')), [false, true, true]);
                assert.deepEqual(Array.from(a.run('videoDataList.map(v => v.position)')), [1, 3, 4]);
                assert.deepEqual(a.get('videoList').children.map(row => row.children[2].children[0].textContent),
                    ['1. Repeated', '3. Third', '4. Repeated']);
            };
            await btn.click();
            verify();
            const before = kind === 'web' ? a.storage.get('ytPlaylistHistory') : JSON.stringify(a.savedExtensionStates);
            const pending = btn.click();
            if (stop === 'cancel') await a.get('cancelCalculationBtn').click();
            else Array.from(a.timers.values())[0].callback();
            await pending;
            verify();
            assert.equal(kind === 'web' ? a.storage.get('ytPlaylistHistory') : JSON.stringify(a.savedExtensionStates), before);
            assert.match(a.get('calculationStatus').textContent, stop === 'cancel' ? /cancelled/ : /timed out/);
            await btn.click();
            verify();
            assert.match(a.get('calculationStatus').textContent, /invalid response/);
            assert.equal(kind === 'web' ? a.storage.get('ytPlaylistHistory') : JSON.stringify(a.savedExtensionStates), before);
            await btn.click();
            verify();
            late({ ok: true, json: async () => ({ videos: [{ id: 'abcdefghijk', title: 'Late', duration: 'PT999S', position: 99 }] }) });
            await new Promise(setImmediate);
            verify();
            assert.equal(a.get('calculationStatus').textContent, '');
            assert.equal(a.timers.size, 0);
            assert.equal(a.calls.length, 4);
            if (kind === 'extension') assert.deepEqual(Array.from(a.savedExtensionStates.at(-1).savedData, v => v.position), [1, 3, 4]);
        });
    }
}
