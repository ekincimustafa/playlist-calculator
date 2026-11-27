const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../i18n.js'), 'utf8');
function page({ languages = ['en-US'], saved, blocked = false } = {}) {
    const storage = new Map(saved === undefined ? [] : [['ytPlaylistLanguage', saved]]);
    const events = [];
    const alerts = [];
    function element(attributes = {}) {
        return {
            attributes, dataset: { i18n: attributes['data-i18n'], language: attributes['data-language'] }, listeners: {}, hidden: true,
            focus() { document.activeElement = this; },
            set innerHTML(_) { throw new Error('Translations must not use HTML parsing'); },
            getAttribute(name) { return this.attributes[name]; },
            setAttribute(name, value) { this.attributes[name] = value; },
            addEventListener(name, callback) { this.listeners[name] = callback; }
        };
    }
    const heading = element({ 'data-i18n': 'headingRest' });
    const input = element({ 'data-i18n-placeholder': 'placeholder', 'data-i18n-aria-label': 'urlLabel' });
    const toggle = element();
    const menu = element();
    const control = element();
    const choices = ['auto', 'en', 'tr', 'es', 'pt', 'hi', 'ur', 'zh-Hant', 'ar'].map(language => element({ 'data-language': language }));
    control.contains = target => [toggle, menu, ...choices].includes(target);
    const privacy = element();
    const document = {
        documentElement: {},
        querySelectorAll: selector => selector === '[data-language]' ? choices : [heading, input].filter(el => Object.hasOwn(el.attributes, selector.slice(1, -1))),
        getElementById: id => ({ languageToggle: toggle, languageMenu: menu, languageControl: control, privacyLink: privacy })[id]
    };
    const window = { dispatchEvent: event => events.push(event.type) };
    const context = vm.createContext({ document, window, navigator: { languages }, Event, alert: text => alerts.push(text), localStorage: {
        getItem(key) { if (blocked) throw Error('Storage blocked'); return storage.get(key) ?? null; },
        setItem(key, value) { if (blocked) throw Error('Storage blocked'); storage.set(key, value); },
        removeItem(key) { if (blocked) throw Error('Storage blocked'); storage.delete(key); }
    } });
    vm.runInContext(source, context);
    return { document, window, heading, input, events, alerts, storage,
        change: value => {
            const choice = choices.find(choice => choice.dataset.language === value) || choices[0];
            const oldValue = choice.dataset.language;
            choice.dataset.language = value;
            choice.listeners.click();
            choice.dataset.language = oldValue;
        },
        privacy: () => privacy.listeners.click({ preventDefault() {} }) };
}

test('browser language negotiation checks regional variants and the ordered preference list', () => {
    assert.equal(page({ languages: ['ja-JP', 'pt-BR', 'en-US'] }).document.documentElement.lang, 'pt');
    assert.equal(page({ languages: ['es-CL', 'tr-TR'] }).document.documentElement.lang, 'es');
    assert.equal(page({ languages: ['ja-JP'] }).document.documentElement.lang, 'en');
});

test('explicit preference wins over the browser and automatic mode removes only that preference', () => {
    const p = page({ languages: ['tr-TR'], saved: 'pt' });
    p.storage.set('ytPlaylistHistory', '[{"title":"Keep me"}]');
    assert.equal(p.document.documentElement.lang, 'pt');
    p.change('es');
    assert.equal(p.document.documentElement.lang, 'es');
    assert.equal(p.storage.get('ytPlaylistLanguage'), 'es');
    p.change('auto');
    assert.equal(p.document.documentElement.lang, 'tr');
    assert.equal(p.storage.has('ytPlaylistLanguage'), false);
    assert.equal(p.storage.get('ytPlaylistHistory'), '[{"title":"Keep me"}]');
});

test('invalid preferences and prototype property names cannot select an unsupported catalog', () => {
    for (const saved of ['xx', '__proto__', 'constructor', '<img onerror=alert(1)>']) {
        const p = page({ languages: ['tr'], saved });
        assert.equal(p.document.documentElement.lang, 'tr');
        p.change(saved);
        assert.equal(p.document.documentElement.lang, 'tr');
    }
});

test('blocked storage still allows detection and changing language in the current page', () => {
    const p = page({ languages: ['tr-TR'], blocked: true });
    assert.equal(p.document.documentElement.lang, 'tr');
    p.change('hi');
    assert.equal(p.document.documentElement.lang, 'hi');
});

test('all language catalogs contain matching nonempty keys and interpolation placeholders', () => {
    // Read the private catalogs in an isolated VM without adding a production export.
    const instrumented = source.replace("    const storageKey =", "    window.catalogs = messages;\n    const storageKey =");
    const window = { dispatchEvent() {} };
    vm.runInNewContext(instrumented, { window, navigator: { languages: ['en'] }, Event,
        document: { documentElement: {}, querySelectorAll: () => [], getElementById: () => null },
        localStorage: { getItem: () => null } });
    const keys = Object.keys(window.catalogs.en).sort();
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    for (const [, key] of html.matchAll(/data-i18n(?:-(?:placeholder|title|aria-label|content))?="([^"]+)"/g)) {
        assert.ok(keys.includes(key), `Missing HTML translation: ${key}`);
    }
    for (const [, language] of html.matchAll(/data-language="([^"]+)"/g)) {
        assert.ok(language === 'auto' || Object.hasOwn(window.catalogs, language), `Missing selectable language: ${language}`);
    }
    const placeholders = text => (text.match(/\{\w+\}/g) || []).sort();
    for (const [language, catalog] of Object.entries(window.catalogs)) {
        assert.deepEqual(Object.keys(catalog).sort(), keys, language);
        for (const key of keys) {
            assert.ok(catalog[key].length, `${language}.${key}`);
            assert.deepEqual(placeholders(catalog[key]), placeholders(window.catalogs.en[key]), `${language}.${key}`);
        }
    }
});

test('language changes update document metadata, accessible attributes and dynamic message translations', () => {
    const p = page();
    p.change('tr');
    assert.equal(p.document.title, 'YouTube Oynatma Listesi Süre Hesaplayıcı');
    assert.equal(p.input.attributes['aria-label'], 'YouTube oynatma listesi veya video bağlantısı');
    assert.match(p.input.attributes.placeholder, /bağlantısını/);
    assert.equal(p.window.PlaylistI18n.message('The request timed out. Please try again.'), 'İstek zaman aşımına uğradı. Lütfen yeniden deneyin.');
    assert.equal(p.window.PlaylistI18n.t('videoCount', { count: '<img>' }), '<img> video');
    assert.deepEqual(p.events, ['playlist-language-change', 'playlist-language-change']);
    p.change('en');
    assert.equal(p.window.PlaylistI18n.message('Private playlist'), 'Private playlist');
});

test('privacy information is localized and describes language storage, server requests and analytics', () => {
    const p = page({ saved: 'tr' });
    p.privacy();
    assert.match(p.alerts[0], /dil tercihiniz/);
    assert.match(p.alerts[0], /Google Analytics/);
    assert.match(p.alerts[0], /IP/);
    assert.match(p.alerts[0], /YouTube/);
});


test('Traditional Chinese respects regional/script preferences without replacing Simplified Chinese', () => {
    for (const locale of ['zh-HK', 'zh-TW', 'zh-MO', 'zh-Hant', 'zh-Hant-HK']) {
        assert.equal(page({ languages: [locale] }).document.documentElement.lang, 'zh-Hant');
    }
    for (const locale of ['zh-CN', 'zh-Hans', 'zh-Hans-HK']) {
        assert.equal(page({ languages: [locale, 'en'] }).document.documentElement.lang, 'en');
    }
});

test('Arabic and Urdu switch direction and switching back restores left-to-right layout', () => {
    const p = page();
    for (const language of ['ar', 'ur']) {
        p.change(language);
        assert.equal(p.document.documentElement.dir, 'rtl');
    }
    for (const language of ['en', 'tr', 'hi', 'zh-Hant']) {
        p.change(language);
        assert.equal(p.document.documentElement.dir, 'ltr');
    }
});
