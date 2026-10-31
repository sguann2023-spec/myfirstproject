import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'vitest';
import { ensureLoginServicesReady } from './loginServicesReady';
const mainSource = await readFile(new URL('../main/services/LegacyMainCompatIpc.ts', import.meta.url), 'utf8');
// Exercise the registered handler in isolation: no Electron process or real database.
const handlerSource = mainSource.split("safeHandle('app:initialize-login-services', async () => {")[1]
    .split("\n  })")[0]
    .replaceAll(/await import\(([^)]+)\)/g, 'await load($1)')
    .replaceAll('error as Error', 'error');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const handler = new AsyncFunction('load', 'logger', handlerSource);
const logger = { warn() {} };

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function loader(database, models = Promise.resolve()) {
    return async (name) => {
        if (name.endsWith('/DatabaseManager')) return { DatabaseManager: { getInstance: () => database } };
        if (name.endsWith('shell-env')) return { preheatShellEnv() {} };
        if (name.endsWith('/models')) return { modelsService: { getModels: () => models } };
        throw new Error(`Unexpected import ${name}`);
    };
}

test('login IPC cannot report ready until schema initialization finishes', async () => {
    const database = deferred();
    let ready = false;
    const result = handler(loader(database.promise), logger).then((value) => { ready = true; return value; });
    await new Promise(setImmediate);
    assert.equal(ready, false);
    database.resolve({});
    assert.deepEqual(await result, { success: true });
});

test('login IPC propagates schema migration failure', async () => {
    const database = deferred();
    const result = handler(loader(database.promise), logger);
    database.reject(new Error('migration failed'));
    await assert.rejects(result, /migration failed/);
});

test('model prewarming remains nonblocking after schema readiness', async () => {
    const models = deferred();
    assert.deepEqual(await handler(loader(Promise.resolve({}), models.promise), logger), { success: true });
    models.resolve({});
});

test('renderer readiness waits for IPC acknowledgement', async () => {
    const ipc = deferred();
    let ready = false;
    const result = ensureLoginServicesReady({ invoke(channel) {
        assert.equal(channel, 'app:initialize-login-services');
        return ipc.promise;
    } }).then(() => { ready = true; });
    await new Promise(setImmediate);
    assert.equal(ready, false);
    ipc.resolve({ success: true });
    await result;
    assert.equal(ready, true);
});

test('renderer rejects structured failures, missing acknowledgement, and IPC errors', async () => {
    for (const result of [{ success: false, error: 'migration failed' }, undefined, {}]) {
        await assert.rejects(ensureLoginServicesReady({ invoke: async () => result }),
            /migration failed|Login services initialization failed/);
    }
    await assert.rejects(ensureLoginServicesReady({ invoke: async () => { throw new Error('IPC failed'); } }), /IPC failed/);
});

test('home entry points and persisted login retain readiness gates', async () => {
    const app = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
    const login = await readFile(new URL('../page/LoginPage/LoginPage.jsx', import.meta.url), 'utf8');
    assert.match(app, /await ensureLoginServicesReady\(ipcRenderer\);[\s\S]*?await homeRuntimeInitPromise/);
    assert.match(app, /const onGuiderFinished = async[\s\S]*?await prepareHomeRuntime\(\);[\s\S]*?setCurrentPage\('home'\)/);
    assert.match(app, /draftIds.length > 0\) \{\s*await prepareHomeRuntime\(\)/);
    assert.match(login, /await ensureLoginServicesReady\(ipcRenderer\);/);
    assert.match(login, /const handleLogin = async \(\) => \{\s*if \(isLoginPreInitLoading \|\| loginPreInitError\)/);
    assert.match(login, /const preInitResult = await loginPreInitPromise;\s*if \(!loginPreInitPromise \|\| loginPreInitCachedError \|\| preInitResult\?\.installing\)/);
    assert.match(login, /disabled=\{!!loginPreInitError\}/);
});
