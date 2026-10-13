const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer } = require('./helpers/player.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

function seed(p) {
    p.storage.set('iwebplayer.active', JSON.stringify({ playlist: 'Test', songName: 'A - Artist', time: 60 }));
    p.storage.set('iwebplayer.pl_last', JSON.stringify({ Test: { name: 'A - Artist', time: 60 } }));
    p.storage.set('iwebplayer.pl_history', JSON.stringify({ Test: [{ name: 'A - Artist', time: 60 }] }));
    p.storage.set('iwebplayer.standalone_time', '60');
}

test('off ignores old bookmarks and explicit historical startup time', async () => {
    for (const time of [0, 60]) {
        const p = createPlayer();
        seed(p);
        const play = p.ctx.playSong(0, false, time);
        p.requests[0].resolve({ url: '/audio-A.mp3' });
        await play;
        assert.equal(p.audio.currentTime, 0);
        assert.equal(p.ctx.ProgressManager.getActive().time, 0);
        assert.equal(p.ctx.ProgressManager.getPlLast('Test').time, 0);
        assert.equal(p.ctx.ProgressManager.getStandaloneTime(), 0);
    }
});

test('off never stores historical timestamps in any progress record', () => {
    const p = createPlayer();
    const pm = p.ctx.ProgressManager;
    pm.setActive('Test', 'A - Artist', 60);
    pm.setPlLast('Test', 'A - Artist', 60);
    pm.setPlHistory('Test', 'A - Artist', 60);
    pm.setStandaloneTime(60);
    assert.equal(JSON.parse(p.storage.get('iwebplayer.active')).time, 0);
    assert.equal(JSON.parse(p.storage.get('iwebplayer.pl_last')).Test.time, 0);
    assert.equal(p.storage.has('iwebplayer.pl_history'), false);
    assert.equal(p.storage.has('iwebplayer.standalone_time'), false);
});

test('local mode still saves and restores independent history', async () => {
    const p = createPlayer();
    p.ctx.ConfigManager.set('config', 'playlist_configs', { Test: { resumeLocal: 'local' } });
    p.ctx.ProgressManager.setPlHistory('Test', 'A - Artist', 60);
    p.ctx.ProgressManager.setPlHistory('Test', 'B - Artist', 10);
    const play = p.ctx.playSong(0, false);
    p.requests[0].resolve({ url: '/audio-A.mp3' });
    await play;
    assert.equal(p.audio.currentTime, 60);
});

test('global mode still restores cloud history', async () => {
    const p = createPlayer();
    p.ctx.ConfigManager.set('config', 'playlist_configs', { Test: { resumeLocal: 'global' } });
    const play = p.ctx.playSong(0, false);
    p.requests[0].resolve({ url: '/audio-A.mp3' });
    await tick();
    p.requests[1].resolve({ data: { songName: 'A - Artist', time: 80 } });
    await play;
    assert.equal(p.audio.currentTime, 80);
});

test('turning off while cloud/metadata is pending prevents restoration', async () => {
    const p = createPlayer({ readyState: 0 });
    p.ctx.ConfigManager.set('config', 'playlist_configs', { Test: { resumeLocal: 'global' } });
    const play = p.ctx.playSong(0, false);
    p.requests[0].resolve({ url: '/audio-A.mp3' });
    await tick();
    p.ctx.savePlaylistConfig('Test', { resumeLocal: 'off' });
    p.requests[1].resolve({ data: { songName: 'A - Artist', time: 80 } });
    await play;
    p.audio.emit('loadedmetadata');
    assert.equal(p.audio.currentTime, 0);
});

test('explicit same-session recovery is allowed without historical storage', async () => {
    const p = createPlayer();
    const play = p.ctx.playSong(0, false, 60, { resumeKind: 'session' });
    p.requests[0].resolve({ url: '/audio-A.mp3' });
    await play;
    assert.equal(p.audio.currentTime, 60);
    assert.equal(JSON.parse(p.storage.get('iwebplayer.active')).time, 0);
});

test('disabling resume cancels queued cloud writes', () => {
    const p = createPlayer();
    p.ctx.ConfigManager.set('config', 'playlist_configs', { Test: { resumeLocal: 'global' } });
    p.ctx.syncToCloud('Test', 'A - Artist', 60, 1, true);
    p.ctx.syncToCloud('Test', 'A - Artist', 62, 1);
    assert.equal(p.requests.length, 1);
    p.ctx.savePlaylistConfig('Test', { resumeLocal: 'off' });
    for (const fn of p.timers.values()) fn();
    assert.equal(p.requests.length, 1);
});

test('PWA pause retains the resource and in-session position', () => {
    const p = createPlayer();
    p.ctx.navigator.standalone = true;
    p.ctx.initStandalonePatch(p.audio, () => {});
    p.audio.pause();
    assert.equal(p.audio.src, '/audio-A.mp3');
    assert.equal(p.audio.currentTime, 60);
    assert.equal(p.storage.has('iwebplayer.standalone_time'), false);
});
