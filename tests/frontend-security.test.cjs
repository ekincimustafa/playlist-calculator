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
        this.value = '';
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

function app(kind) {
    const elements = new Map();
    const ready = [];
    const storage = new Map();
    const calls = [];
    const savedExtensionStates = [];
    const alerts = [];
    const videos = [
        { id: 'abcdefghijk', title: 'First video', thumbnail: 'https://i.ytimg.com/a.jpg', duration: 'PT10M' },
        { id: 'lmnopqrstuv', title: 'Second video', thumbnail: 'https://i.ytimg.com/b.jpg', duration: 'PT5M' }
    ];
    const get = id => {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
    };
    get('speedRange').value = '1';
    const context = vm.createContext({
        Date, URL,
        console: { error: error => { throw error; } },
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
            tabs: { query: (_options, callback) => callback([{ url: 'https://www.youtube.com/playlist?list=PLtest123' }]) },
            storage: { local: {
                get: (_keys, callback) => callback({}),
                set: state => savedExtensionStates.push(state)
            } }
        },
        fetch: async url => {
            calls.push(url);
            return { ok: true, json: async () => ({ total_videos: videos.length, videos }) };
        }
    });
    const file = kind === 'web' ? 'script.js' : 'extension/popup.js';
    vm.runInContext(fs.readFileSync(path.join(sourceRoot, file), 'utf8'), context, { filename: file });
    return {
        get, storage, calls, alerts, savedExtensionStates,
        run: code => vm.runInContext(code, context),
        ready: async () => { for (const callback of ready) await callback(); }
    };
}

test('crafted playlist input stays inside one iframe property', async () => {
    const a = app('web');
    await a.ready();
    const craftedId = 'PLtest"></iframe>' + attack;
    a.get('playlistUrl').value = 'https://www.youtube.com/playlist?list=' + craftedId;
    await a.get('calcBtn').click();
    const player = a.get('videoPlayer');
    assert.equal(player.children.length, 1);
    const iframe = player.children[0];
    assert.equal(iframe.tagName, 'iframe');
    assert.equal(iframe.src, 'https://www.youtube.com/embed/videoseries?list=' + craftedId);
    assert.equal(iframe.children.length, 0);
    assert.equal(iframe.onerror, undefined);
    assert.equal(a.alerts.length, 0);
});

test('normal video and playlist embeds keep their source and fullscreen support', () => {
    const a = app('web');
    for (const [id, kind, expected] of [
        ['PLtest123', 'playlist', 'https://www.youtube.com/embed/videoseries?list=PLtest123'],
        ['abcdefghijk', 'video', 'https://www.youtube.com/embed/abcdefghijk']
    ]) {
        a.run(`embedPlayer(${JSON.stringify(id)}, ${JSON.stringify(kind)})`);
        const iframe = a.get('videoPlayer').children[0];
        assert.equal(iframe.src, expected);
        assert.equal(iframe.allowFullscreen, true);
        assert.equal(a.get('videoPlayer').children.length, 1);
    }
});

for (const kind of ['web', 'extension']) {
    test(`${kind}: untrusted video title and thumbnail cannot create HTML or event attributes`, () => {
        const a = app(kind);
        const thumbnail = 'https://i.ytimg.com/a.jpg" onerror="alert(1)';
        a.run(`videoDataList = ${JSON.stringify([{ title: attack, thumb: thumbnail, duration: 90, active: true }])}; renderVideoList();`);
        const row = a.get('videoList').children[0];
        assert.equal(row.className, 'video-item');
        assert.deepEqual(row.children.map(child => child.tagName), ['input', 'img', 'div']);
        assert.equal(row.children[0].type, 'checkbox');
        assert.equal(row.children[0].checked, true);
        assert.equal(row.children[1].src, thumbnail);
        assert.equal(row.children[1].onerror, undefined);
        assert.equal(row.children[1].loading, 'lazy');
        const [title, duration] = row.children[2].children;
        assert.equal(title.className, 'v-title');
        assert.equal(title.textContent, '1. ' + attack);
        assert.equal(title.children.length, 0);
        assert.equal(duration.className, 'v-duration');
        assert.equal(duration.textContent, '1:30');
        assert.equal(row.children[2].className, kind === 'web' ? 'video-info' : '');
        a.run('renderVideoList()');
        assert.equal(a.get('videoList').children.length, 1);
    });

    test(`${kind}: normal calculation and video selection keep their existing totals`, async () => {
        const a = app(kind);
        await a.ready();
        if (kind === 'web') a.get('playlistUrl').value = 'https://www.youtube.com/playlist?list=PLtest123';
        await a.get('calcBtn').click();
        assert.equal(a.calls.length, 1);
        assert.equal(a.calls[0], 'https://playlist-backend-6ojq.onrender.com/api/playlist/PLtest123');
        assert.equal(a.run('totalSecondsGlobal'), 900);
        assert.equal(a.get('videoCount').innerText, '2');
        assert.equal(a.get(kind === 'web' ? 'avgVideo' : 'avgTime').innerText, '7m 30s');
        if (kind === 'web') {
            assert.equal(a.get('minutes').innerText, '15');
            assert.equal(a.get('resultSection').style.display, 'flex');
        } else {
            assert.equal(a.get('totalTimeDisplay').innerText, '15m 0s');
            assert.equal(a.get('resultCard').style.display, 'block');
        }
        const firstRow = a.get('videoList').children[0];
        await firstRow.click({ target: firstRow });
        assert.equal(a.run('totalSecondsGlobal'), 300);
        assert.equal(a.get('videoCount').innerText, '1');
        const secondRow = a.get('videoList').children[1];
        secondRow.children[0].checked = false;
        await secondRow.click({ target: secondRow.children[0] });
        assert.equal(a.run('totalSecondsGlobal'), 0);
        assert.equal(a.get('videoCount').innerText, '0');
        if (kind === 'extension') assert.ok(a.savedExtensionStates.length >= 3);
        assert.equal(a.alerts.length, 0);
    });
}

test('all history display fields are literal text, including stored metadata', () => {
    const a = app('web');
    a.storage.set('ytPlaylistHistory', JSON.stringify([{
        url: 'https://www.youtube.com/playlist?list=PLtest123',
        title: attack, videoCount: attack, duration: attack
    }]));
    a.run('renderHistory()');
    const row = a.get('historyList').children[0];
    assert.equal(row.className, 'history-item');
    assert.deepEqual(row.children.map(child => child.className), ['history-title', 'history-info']);
    assert.equal(row.children[0].textContent, attack);
    assert.equal(row.children[1].textContent, `${attack} Videos • ${attack}`);
    assert.ok(row.children.every(child => child.children.length === 0));
    a.run('renderHistory()');
    assert.equal(a.get('historyList').children.length, 1);
});

test('history selection and clearing retain the current behavior and labels', async () => {
    const a = app('web');
    await a.ready();
    const url = 'https://www.youtube.com/playlist?list=PLtest123';
    a.storage.set('ytPlaylistHistory', JSON.stringify([{
        url, title: 'A saved playlist', videoCount: 2, duration: '0h 15m 0s'
    }]));
    a.run('renderHistory()');
    await a.get('historyList').children[0].click();
    // The history handler starts the asynchronous button callback without returning it.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(a.get('playlistUrl').value, url);
    assert.equal(a.calls.length, 1);
    assert.equal(a.run('totalSecondsGlobal'), 900);
    await a.get('clearHistoryBtn').click();
    const items = a.get('historyList').children;
    assert.equal(items.length, 1);
    assert.equal(items[0].className, 'empty-history');
    assert.equal(items[0].textContent, 'No recent history.');
    assert.equal(a.storage.has('ytPlaylistHistory'), false);
});
