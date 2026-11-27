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
        changeLanguage: () => windowListeners.get('playlist-language-change')(),
        run: code => vm.runInContext(code, context),
        ready: async () => { for (const callback of ready) await callback(); }
    };
}

test('crafted playlist input is rejected before a request or embed', async () => {
    const a = app('web');
    await a.ready();
    const craftedId = 'PLtest"></iframe>' + attack;
    a.get('playlistUrl').value = 'https://www.youtube.com/playlist?list=' + craftedId;
    await a.get('calcBtn').click();
    assert.equal(a.get('videoPlayer').children.length, 0);
    assert.equal(a.calls.length, 0);
    assert.equal(a.get('calculationStatus').textContent, 'Please enter a valid YouTube link!');
});

test('direct embed rendering still treats crafted IDs as one property', () => {
    const a = app('web');
    const craftedId = 'PLtest"></iframe>' + attack;
    a.run(`embedPlayer(${JSON.stringify(craftedId)}, 'playlist')`);
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

test('web: Enter during a pending calculation cannot mix results from two URLs', async () => {
    const firstUrl = 'https://www.youtube.com/playlist?list=PLfirst';
    const secondUrl = 'https://www.youtube.com/playlist?list=PLsecond';
    const firstVideos = [
        { id: 'abcdefghijk', title: 'First playlist video', duration: 'PT10M' },
        { id: 'lmnopqrstuv', title: 'Another first playlist video', duration: 'PT5M' }
    ];
    const secondVideos = [{ id: 'wxyzabcdefg', title: 'Second playlist video', duration: 'PT42S' }];
    const response = videos => ({ ok: true, json: async () => ({ total_videos: videos.length, videos }) });
    let resolveFirst;
    const firstResponse = new Promise(resolve => { resolveFirst = resolve; });
    const a = app('web', {
        fetch: url => url.endsWith('/PLfirst') ? firstResponse : response(secondVideos)
    });
    await a.ready();
    const calcBtn = a.get('calcBtn');
    const urlInput = a.get('playlistUrl');
    urlInput.value = firstUrl;
    const firstCalculation = calcBtn.click();
    assert.equal(calcBtn.disabled, true);

    urlInput.value = secondUrl;
    await urlInput.dispatch('keypress', { key: 'Enter' });
    // Let the second response finish if Enter started a request.
    await new Promise(setImmediate);
    const stillProcessing = calcBtn.disabled;
    resolveFirst(response(firstVideos));
    await firstCalculation;

    const history = () => JSON.parse(a.storage.get('ytPlaylistHistory'));
    assert.equal(a.get('videoCount').innerText, '2');
    assert.equal(a.get('minutes').innerText, '15');
    assert.equal(a.get('seconds').innerText, '0');
    assert.equal(a.get('videoList').children.length, 2);
    assert.deepEqual(history().map(item => [item.url, item.videoCount, item.duration]), [[firstUrl, 2, '0h 15m 0s']]);
    assert.equal(a.get('videoPlayer').children[0].src, 'https://www.youtube.com/embed/videoseries?list=PLfirst');
    assert.equal(stillProcessing, true);
    assert.equal(a.calls.length, 1);
    assert.equal(calcBtn.disabled, false);
    assert.equal(calcBtn.innerText, 'Calculate Duration');

    await calcBtn.click();
    assert.equal(a.calls.length, 2);
    assert.equal(a.get('videoCount').innerText, '1');
    assert.equal(a.get('seconds').innerText, '42');
    assert.deepEqual(history().map(item => item.url), [secondUrl, firstUrl]);
});

test('web: a failed calculation releases the button for a retry', async () => {
    const errors = [];
    let fail = true;
    const a = app('web', {
        onError: error => errors.push(error.message),
        fetch: async () => ({
            ok: !fail,
            json: async () => fail
                ? { detail: 'Backend unavailable' }
                : { total_videos: 1, videos: [{ id: 'abcdefghijk', title: 'Video', duration: 'PT1M' }] }
        })
    });
    await a.ready();
    a.get('playlistUrl').value = 'https://www.youtube.com/watch?v=abcdefghijk';
    const calcBtn = a.get('calcBtn');
    await calcBtn.click();

    assert.deepEqual(errors, []);
    assert.deepEqual(a.alerts, []);
    assert.equal(a.get('calculationStatus').textContent, 'Backend unavailable');
    assert.equal(calcBtn.disabled, false);
    assert.equal(calcBtn.innerText, 'Calculate Duration');

    fail = false;
    await calcBtn.click();
    assert.equal(a.calls.length, 2);
    assert.equal(a.get('videoCount').innerText, '1');
    assert.equal(a.get('minutes').innerText, '1');
});

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

for (const kind of ['web', 'extension']) {
    test(`${kind}: supported YouTube URL formats resolve the correct IDs`, () => {
        const a = app(kind);
        for (const url of [
            'https://www.youtube.com/watch?v=abcdefghijk',
            'youtube.com/watch?v=abcdefghijk',
            'https://m.youtube.com/watch?v=abcdefghijk',
            'https://music.youtube.com/watch?v=abcdefghijk',
            'https://youtu.be/abcdefghijk?t=12',
            'https://www.youtube.com/shorts/abcdefghijk',
            'https://www.youtube.com/embed/abcdefghijk',
            'https://www.youtube.com/live/abcdefghijk',
        ]) {
            assert.equal(a.run(`extractVideoId(${JSON.stringify(url)})`), 'abcdefghijk', url);
        }
        for (const url of [
            'https://www.youtube.com/playlist?list=PLtest123',
            'https://youtu.be/abcdefghijk?list=PLtest123',
        ]) {
            assert.equal(a.run(`extractPlaylistId(${JSON.stringify(url)})`), 'PLtest123', url);
        }
    });

    test(`${kind}: unrelated domains and malformed IDs cannot trigger API work`, async () => {
        const invalidUrls = [
            'https://other.example/watch?v=abcdefghijk&list=PLtest123',
            'https://youtube.com.other.example/watch?v=abcdefghijk',
            'https://youtube.com@other.example/watch?v=abcdefghijk',
            'https://www.youtube.com/watch?v=abcdefghijk_extra',
            'https://www.youtube.com/playlist?list=PLtest%22%3E',
            'not a URL',
        ];
        for (const url of invalidUrls) {
            const a = app(kind, { tabUrl: url });
            await a.ready();
            if (kind === 'web') a.get('playlistUrl').value = url;
            await a.get('calcBtn').click();
            assert.equal(a.calls.length, 0, url);
            assert.equal(a.get('videoList').children.length, 0, url);
        }
    });
}

test('custom speeds below 1x keep totals, average, finish time and selection synchronized', async () => {
    const now = Date.parse('2026-10-16T10:00:00Z');
    class FrozenDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
    }
    const finish = seconds => new Date(now + seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const a = app('web', { Date: FrozenDate });
    await a.ready();
    a.get('playlistUrl').value = 'https://www.youtube.com/playlist?list=PLtest123';
    await a.get('calcBtn').click();
    a.run('updateCustomSpeed(0.25)');
    assert.equal(a.get('speedValue').innerText, '0.25x');
    assert.equal(a.get('speedRange').value, '1'); // Same native clamp as the real browser.
    assert.equal(a.get('hours').innerText, '1');
    assert.equal(a.get('minutes').innerText, '0');
    assert.equal(a.get('avgVideo').innerText, '30m 0s');
    assert.equal(a.get('finishTime').innerText, finish(3600));

    await a.get('videoList').children[0].click({ target: a.get('videoList').children[0] });
    assert.equal(a.get('minutes').innerText, '20');
    assert.equal(a.get('avgVideo').innerText, '20m 0s');
    assert.equal(a.get('finishTime').innerText, finish(1200));

    a.get('speedRange').value = '2';
    await a.get('speedRange').dispatch('input');
    assert.equal(a.get('minutes').innerText, '2');
    assert.equal(a.get('seconds').innerText, '30');
    assert.equal(a.get('avgVideo').innerText, '2m 30s');
    assert.equal(a.get('finishTime').innerText, finish(150));
    a.run('updateCustomSpeed(0.5)');
    await a.get('calcBtn').click();
    assert.equal(a.get('minutes').innerText, '30');
    assert.equal(a.get('avgVideo').innerText, '15m 0s');
    assert.equal(a.get('finishTime').innerText, finish(1800));
});

test('custom speed bounds remain 0.25x through 5x with a 1x invalid-value fallback', () => {
    const a = app('web');
    for (const [input, expected] of [[-1, 0.25], [9, 5], ['invalid', 1], [1.37, 1.37]]) {
        a.run(`updateCustomSpeed(${JSON.stringify(input)})`);
        assert.equal(a.get('speedValue').innerText, expected.toFixed(2) + 'x');
    }
});

test('extension playlist index selects from the current video on a fresh calculation', async () => {
    const a = app('extension', { tabUrl: 'https://www.youtube.com/watch?v=lmnopqrstuv&list=PLtest123&index=2' });
    await a.ready();
    await a.get('calcBtn').click();
    assert.equal(a.get('videoCount').innerText, '1');
    assert.equal(a.get('totalTimeDisplay').innerText, '5m 0s');
    assert.deepEqual(Array.from(a.run('videoDataList.map(v => v.active)')), [false, true]);
});

test('extension playlist index also applies when restoring saved results', async () => {
    const savedData = [100, 200, 300].map((duration, index) => ({
        id: String(index), title: 'Video ' + index, duration, active: true, thumb: '', position: index + 1
    }));
    const a = app('extension', {
        tabUrl: 'https://www.youtube.com/playlist?list=PLtest123&index=3',
        savedState: { savedPId: 'PLtest123', savedData, savedSpeed: 1 },
    });
    await a.ready();
    assert.equal(a.calls.length, 0);
    assert.equal(a.get('videoCount').innerText, '1');
    assert.equal(a.get('totalTimeDisplay').innerText, '5m 0s');
    assert.deepEqual(Array.from(a.run('videoDataList.map(v => v.active)')), [false, false, true]);
});

for (const kind of ['web', 'extension']) {
    test(`${kind}: playlist positions preserve gaps and duplicate entries when applying index`, async () => {
        const url = 'https://www.youtube.com/watch?v=abcdefghijk&list=PLtest123&index=3';
        const videos = [
            { id: 'abcdefghijk', title: 'Repeated', duration: 'PT10M', position: 1 },
            { id: 'lmnopqrstuv', title: 'After missing video', duration: 'PT5M', position: 3 },
            { id: 'abcdefghijk', title: 'Repeated', duration: 'PT10M', position: 4 }
        ];
        const a = app(kind, { tabUrl: url, fetch: async () => ({ ok: true, json: async () => ({ videos }) }) });
        await a.ready();
        if (kind === 'web') a.get('playlistUrl').value = url;
        await a.get('calcBtn').click();
        assert.deepEqual(Array.from(a.run('videoDataList.map(v => v.active)')), [false, true, true]);
        assert.equal(a.run('totalSecondsGlobal'), 900);
        assert.deepEqual(a.get('videoList').children.map(row => row.children[2].children[0].textContent),
            ['1. Repeated', '3. After missing video', '4. Repeated']);
        const duplicateRow = a.get('videoList').children[2];
        await duplicateRow.click({ target: duplicateRow });
        assert.equal(a.run('totalSecondsGlobal'), 300);
        if (kind === 'extension') {
            assert.deepEqual(Array.from(a.savedExtensionStates.at(-1).savedData, v => v.position), [1, 3, 4]);
        }
    });

    test(`${kind}: invalid indexes use all videos and an index past the end selects none`, async () => {
        for (const [index, expected] of [['0', 900], ['-1', 900], ['2bad', 900], ['1.5', 900], ['9007199254740992', 900], ['', 900], ['3', 0]]) {
            const url = 'https://www.youtube.com/playlist?list=PLtest123&index=' + index;
            const a = app(kind, { tabUrl: url });
            await a.ready();
            if (kind === 'web') a.get('playlistUrl').value = url;
            await a.get('calcBtn').click();
            assert.equal(a.run('totalSecondsGlobal'), expected, index);
        }
        const url = 'https://www.youtube.com/watch?v=abcdefghijk&index=99';
        const a = app(kind, { tabUrl: url });
        await a.ready();
        if (kind === 'web') a.get('playlistUrl').value = url;
        await a.get('calcBtn').click();
        assert.equal(a.run('totalSecondsGlobal'), 900);
    });
}

test('extension: legacy playlist data waits for recalculation and is replaced with positioned data', async () => {
    const a = app('extension', {
        tabUrl: 'https://www.youtube.com/playlist?list=PLtest123&index=3',
        savedState: { savedPId: 'PLtest123', savedData: [{ id: 'abcdefghijk', duration: 600, active: true }], savedSpeed: 2 },
        fetch: async () => ({ ok: true, json: async () => ({ videos: [
            { id: 'abcdefghijk', title: 'Video', duration: 'PT10M', position: 3 }
        ] }) })
    });
    await a.ready();
    assert.equal(a.calls.length, 0);
    assert.equal(a.get('videoList').children.length, 0);
    assert.equal(a.get('calcBtn').disabled, false);
    await a.get('calcBtn').click();
    assert.equal(a.calls.length, 1);
    assert.equal(a.get('videoCount').innerText, '1');
    assert.equal(a.get('totalTimeDisplay').innerText, '5m 0s');
    assert.equal(a.savedExtensionStates.at(-1).savedData[0].position, 3);
});

test('extension: restored positions apply index without moving gaps or resetting manual exclusions', async () => {
    const a = app('extension', {
        tabUrl: 'https://www.youtube.com/playlist?list=PLtest123&index=3',
        savedState: { savedPId: 'PLtest123', savedSpeed: 2, savedData: [
            { id: 'a', title: 'First', duration: 600, active: true, position: 1 },
            { id: 'b', title: 'Third', duration: 300, active: true, position: 3 },
            { id: 'a', title: 'Repeat', duration: 600, active: false, position: 4 }
        ] }
    });
    await a.ready();
    assert.equal(a.calls.length, 0);
    assert.equal(a.get('totalTimeDisplay').innerText, '2m 30s');
    assert.deepEqual(Array.from(a.run('videoDataList.map(v => v.active)')), [false, true, false]);
});

test('extension: legacy single-video results remain usable and ignore playlist index', async () => {
    const a = app('extension', {
        tabUrl: 'https://www.youtube.com/watch?v=abcdefghijk&index=99',
        savedState: { savedVId: 'abcdefghijk', savedSpeed: 2, savedData: [
            { id: 'abcdefghijk', title: 'Video', duration: 600, active: true }
        ] }
    });
    await a.ready();
    assert.equal(a.calls.length, 0);
    assert.equal(a.get('totalTimeDisplay').innerText, '5m 0s');
    assert.equal(a.get('videoCount').innerText, '1');
});

for (const kind of ['web', 'extension']) {
    test(`${kind}: cancelling preserves results and a late response cannot replace a retry`, async () => {
        let requestCount = 0;
        let resolveLate;
        let pendingSignal;
        const response = seconds => ({ ok: true, json: async () => ({ videos: [
            { id: 'abcdefghijk', title: 'Video', duration: `PT${seconds}S` }
        ] }) });
        const a = app(kind, { fetch: async (url, { signal }) => {
            requestCount++;
            if (requestCount === 2) {
                pendingSignal = signal;
                return new Promise(resolve => { resolveLate = resolve; });
            }
            return response(requestCount === 1 ? 600 : 42);
        } });
        await a.ready();
        if (kind === 'web') a.get('playlistUrl').value = 'https://www.youtube.com/playlist?list=PLtest123';
        const button = a.get('calcBtn');
        await button.click();
        const pending = button.click();
        assert.equal(button.disabled, true);
        assert.equal(a.get('cancelCalculationBtn').hidden, false);
        assert.match(a.get('calculationStatus').textContent, /Calculating/);
        assert.equal(a.run('totalSecondsGlobal'), 600);
        await a.get('cancelCalculationBtn').click();
        await pending;
        assert.equal(pendingSignal.aborted, true);
        assert.equal(button.disabled, false);
        assert.equal(a.get('cancelCalculationBtn').hidden, true);
        assert.match(a.get('calculationStatus').textContent, /cancelled/);
        assert.equal(a.run('totalSecondsGlobal'), 600);
        assert.equal(a.timers.size, 0);
        await button.click();
        assert.equal(a.run('totalSecondsGlobal'), 42);
        resolveLate(response(999));
        await new Promise(setImmediate);
        assert.equal(a.run('totalSecondsGlobal'), 42);
        assert.equal(a.get('calculationStatus').textContent, '');
        if (kind === 'web') {
            assert.equal(JSON.parse(a.storage.get('ytPlaylistHistory'))[0].duration, '0h 0m 42s');
        } else {
            assert.equal(a.savedExtensionStates.at(-1).savedData[0].duration, 42);
        }
        assert.equal(a.alerts.length, 0);
    });

    test(`${kind}: the deadline includes response reading and allows a retry after timeout`, async () => {
        let resolveBody;
        let pendingSignal;
        let retry = false;
        const a = app(kind, { fetch: async (url, { signal }) => {
            pendingSignal = signal;
            return { ok: true, json: () => retry
                ? Promise.resolve({ videos: [] })
                : new Promise(resolve => { resolveBody = resolve; }) };
        } });
        await a.ready();
        if (kind === 'web') a.get('playlistUrl').value = 'https://www.youtube.com/watch?v=abcdefghijk';
        const pending = a.get('calcBtn').click();
        await new Promise(setImmediate);
        assert.equal(a.timers.size, 1);
        const timer = Array.from(a.timers.values())[0];
        assert.equal(timer.delay, 150000);
        timer.callback();
        await pending;
        assert.equal(pendingSignal.aborted, true);
        assert.equal(a.get('calcBtn').disabled, false);
        assert.match(a.get('calculationStatus').textContent, /timed out/);
        assert.equal(a.timers.size, 0);
        retry = true;
        await a.get('calcBtn').click();
        resolveBody({ videos: [{ id: 'abcdefghijk', title: 'Late', duration: 'PT999S' }] });
        await new Promise(setImmediate);
        assert.equal(a.run('totalSecondsGlobal'), 0);
        assert.equal(a.get('calculationStatus').textContent, '');
        assert.equal(a.timers.size, 0);
    });

    test(`${kind}: network, HTTP and invalid responses preserve earlier results and show safe errors`, async () => {
        const failures = [
            [async () => { throw new Error('network failure'); }, /Check your connection/],
            [async () => ({ ok: false, json: async () => ({ detail: '<img src=x onerror=alert(1)>' }) }), /<img/],
            [async () => ({ ok: false, json: async () => ({}) }), /could not complete/],
            [async () => ({ ok: false, json: async () => { throw new Error('HTML response'); } }), /unreadable/],
            [async () => ({ ok: true, json: async () => ({ videos: [{}] }) }), /incomplete video/]
        ];
        let fail;
        const a = app(kind, { fetch: async () => fail ? fail() : ({ ok: true, json: async () => ({ videos: [
            { id: 'abcdefghijk', title: 'Original', duration: 'PT10M' }
        ] }) }) });
        await a.ready();
        if (kind === 'web') a.get('playlistUrl').value = 'https://www.youtube.com/playlist?list=PLtest123';
        await a.get('calcBtn').click();
        for (const [load, message] of failures) {
            fail = load;
            await a.get('calcBtn').click();
            assert.match(a.get('calculationStatus').textContent, message);
            assert.equal(a.get('calculationStatus').children.length, 0);
            assert.equal(a.get('calculationStatus').classList.contains('error'), true);
            assert.equal(a.get('calcBtn').disabled, false);
            assert.equal(a.get('cancelCalculationBtn').hidden, true);
            assert.equal(a.run('totalSecondsGlobal'), 600);
            assert.equal(a.get('videoList').children.length, 1);
            assert.equal(a.timers.size, 0);
        }
        assert.equal(a.alerts.length, 0);
    });

    test(`${kind}: leaving the page aborts a pending request`, async () => {
        let signal;
        const a = app(kind, { fetch: (url, options) => {
            signal = options.signal;
            return new Promise(() => {});
        } });
        await a.ready();
        if (kind === 'web') a.get('playlistUrl').value = 'https://www.youtube.com/playlist?list=PLtest123';
        const pending = a.get('calcBtn').click();
        a.leave();
        await pending;
        assert.equal(signal.aborted, true);
        assert.equal(a.timers.size, 0);
        assert.equal(a.storage.size, 0);
        assert.equal(a.savedExtensionStates.length, 0);
    });
}


test('website language refresh preserves totals, selections, history and request count', async () => {
    const a = app('web');
    await a.ready();
    a.get('playlistUrl').value = 'https://www.youtube.com/playlist?list=PLtest123';
    await a.get('calcBtn').click();
    await a.get('videoList').children[0].click({ target: { type: 'checkbox', checked: false } });
    const history = a.storage.get('ytPlaylistHistory');
    const calls = a.calls.length;
    a.run("window.PlaylistI18n = { t: (key, values = {}) => key === 'shortAverage' ? values.minutes + ' dk ' + values.seconds + ' sn' : key === 'calculate' ? 'Süreyi Hesapla' : key, message: text => text, language: 'tr' }");
    a.changeLanguage();
    assert.equal(a.get('minutes').innerText, '5');
    assert.equal(a.get('avgVideo').innerText, '5 dk 0 sn');
    assert.deepEqual(a.get('videoList').children.map(row => row.children[0].checked), [false, true]);
    assert.equal(a.get('calcBtn').innerText, 'Süreyi Hesapla');
    assert.equal(a.storage.get('ytPlaylistHistory'), history);
    assert.equal(a.calls.length, calls);
});

test('changing language during a request preserves the processing lock and cancellation', async () => {
    const a = app('web', { fetch: () => new Promise(() => {}) });
    await a.ready();
    a.get('playlistUrl').value = 'https://www.youtube.com/playlist?list=PLtest123';
    const pending = a.get('calcBtn').click();
    a.run("window.PlaylistI18n = { t: key => key === 'processing' ? 'Hesaplanıyor...' : 'Süreyi Hesapla', message: text => text ? 'Çevrildi: ' + text : '', language: 'tr' }");
    a.changeLanguage();
    assert.equal(a.get('calcBtn').disabled, true);
    assert.equal(a.get('calcBtn').innerText, 'Hesaplanıyor...');
    assert.equal(a.get('cancelCalculationBtn').hidden, false);
    assert.match(a.get('calculationStatus').textContent, /^Çevrildi:/);
    await a.get('cancelCalculationBtn').click();
    await pending;
    assert.equal(a.get('calcBtn').disabled, false);
    assert.equal(a.get('calcBtn').innerText, 'Süreyi Hesapla');
    assert.match(a.get('calculationStatus').textContent, /cancelled/);
    assert.equal(a.calls.length, 1);
});

test('corrupt or blocked history storage cannot break language changes or successful calculations', async () => {
    const a = app('web');
    await a.ready();
    a.storage.set('ytPlaylistHistory', '{broken');
    a.changeLanguage();
    assert.equal(a.get('historyList').children[0].textContent, 'No recent history.');
    a.run("localStorage.getItem = () => { throw Error('Blocked'); }; localStorage.setItem = () => { throw Error('Blocked'); };");
    a.changeLanguage();
    a.get('playlistUrl').value = 'https://www.youtube.com/playlist?list=PLtest123';
    await a.get('calcBtn').click();
    assert.equal(a.get('minutes').innerText, '15');
    assert.equal(a.get('calculationStatus').textContent, '');
});
