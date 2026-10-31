// The main-process DatabaseManager owns singleflight initialization and schema migrations.
// Keep IPC failures (including structured failures) fatal for every home entry path.
export async function ensureLoginServicesReady(ipcRenderer) {
    const result = await ipcRenderer.invoke('app:initialize-login-services');
    if (result?.success !== true) {
        throw new Error(result?.error || 'Login services initialization failed');
    }
}
