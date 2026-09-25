import { activeParts, buildPartsDocument, DRAFT_VERSION, validateParts } from './model';

const isMissing = (error) => error?.code === 'ENOENT' || /ENOENT|no such file/i.test(error?.message || '');

export const parseBoundDocument = (raw, file) => {
  const document = JSON.parse(String(raw).replace(/^\uFEFF/, ''));
  if (document?.type !== 'subtitle_storyboard' || document.version !== DRAFT_VERSION
    || document.source_file !== file.path || document.time_unit !== 'ms') {
    throw new Error('绑定的分镜文件格式不兼容，已暂停同步');
  }
  return { ...document, parts: activeParts(validateParts(document.parts)) };
};

// Serialize reads and writes, including the last write requested during close.
// Compare the disk snapshot before every write so external edits are not lost.
export const createFileBinding = ({ file, recognition, api, onParts, onStatus }) => {
  let baseline;
  let document;
  let pending = null;
  let timer;
  let poll;
  let disposed = false;
  let blocked = false;
  let pollingPaused = false;
  let queue = Promise.resolve();
  const report = (state, message = '') => { if (!disposed) onStatus({ state, message }); };
  const read = async () => {
    try { return String(await api.fs.read(file.draftPath, 'utf8')); }
    catch (error) { if (isMissing(error)) return null; throw error; }
  };
  const serial = (operation) => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  const fail = (error) => {
    blocked = true;
    report('error', error.message || '分镜文件同步失败');
    return false;
  };
  const write = async (parts) => {
    validateParts(parts);
    const next = { ...document, ...buildPartsDocument(file, recognition, parts) };
    const raw = JSON.stringify(next, null, 2);
    await api.file.write(file.draftPath, raw);
    document = next;
    baseline = raw;
  };
  const flushNow = async () => {
    if (!pending) return !blocked;
    if (blocked) return false;
    const parts = pending;
    report('syncing');
    try {
      const disk = await read();
      if (disk !== baseline) {
        blocked = true;
        report('conflict', '文件和界面均有修改，请选择要保留的版本');
        return false;
      }
      await write(parts);
      if (pending === parts) pending = null;
      report(pending ? 'pending' : 'synced');
      return true;
    } catch (error) { return fail(error); }
  };
  const check = () => serial(async () => {
    if (disposed || pollingPaused || (blocked && pending) || baseline === undefined) return;
    try {
      const disk = await read();
      if (disk === baseline) {
        if (blocked) { blocked = false; report('synced'); }
        return;
      }
      if (pending) {
        blocked = true;
        report('conflict', '文件和界面均有修改，请选择要保留的版本');
        return;
      }
      if (disk === null) throw new Error('绑定的分镜文件已被删除或移动，已暂停同步');
      const next = parseBoundDocument(disk, file);
      document = next;
      baseline = disk;
      blocked = false;
      if (!disposed) onParts(next.parts);
      report('synced');
    } catch (error) { fail(error); }
  });
  const ready = serial(async () => {
    report('syncing');
    try {
      baseline = await read();
      if (baseline !== null) {
        document = parseBoundDocument(baseline, file);
        if (!disposed) onParts(document.parts);
      } else {
        // Recheck immediately before creation in case another editor created it.
        const latest = await read();
        if (latest !== null) {
          document = parseBoundDocument(latest, file);
          baseline = latest;
          if (!disposed) onParts(document.parts);
        } else await write(recognition.parts);
      }
      report('synced');
    } catch (error) { fail(error); }
  });
  poll = setInterval(() => { void check(); }, 1000);
  const wake = () => { void check(); };
  window.addEventListener('focus', wake);
  return {
    ready,
    update(parts) {
      pending = parts;
      if (!blocked) report('pending');
      clearTimeout(timer);
      timer = setTimeout(() => { void serial(flushNow); }, 250);
    },
    flush() {
      clearTimeout(timer);
      return serial(flushNow);
    },
    check,
    pausePolling() { pollingPaused = true; },
    resumePolling() { pollingPaused = false; },
    getDocument() { return document; },
    completeAi(original, validate) {
      return serial(async () => {
        let next;
        let raw;
        let restored = false;
        try {
          raw = await read();
          if (raw === null) throw new Error('AI任务结束后分镜文件不存在');
          next = parseBoundDocument(raw, file);
          validate(next);
        } catch {
          // Restore the pre-task snapshot, never metadata from the rejected file.
          try {
            raw = JSON.stringify(original, null, 2);
            next = parseBoundDocument(raw, file);
            await api.file.write(file.draftPath, raw);
            restored = true;
          } catch (error) {
            blocked = true;
            pollingPaused = true;
            report('restore-error', 'AI结果校验失败，且历史版本写回失败。已保留界面历史，请检查文件写入权限。');
            throw error;
          }
        }
        document = next;
        baseline = raw;
        pending = null;
        blocked = false;
        pollingPaused = false;
        if (!disposed) onParts(next.parts);
        report('synced');
        return { restored };
      });
    },
    resolve(mode, validate) {
      return serial(async () => {
        try {
          const disk = await read();
          if (mode === 'disk') {
            if (disk === null) throw new Error('绑定文件不存在，请先恢复文件或保留界面版本');
            const next = parseBoundDocument(disk, file);
            validate?.(next);
            document = next;
            baseline = disk;
            pending = null;
            blocked = false;
            pollingPaused = false;
            if (!disposed) onParts(document.parts);
            report('synced');
            return true;
          }
          // Explicit user choice permits replacing the external version.
          if (disk !== null) {
            try { document = parseBoundDocument(disk, file); }
            catch { /* Explicit replacement can repair a malformed bound file. */ }
          }
          baseline = disk;
          blocked = false;
          if (!pending) pending = document?.parts || recognition.parts;
          const saved = await flushNow();
          if (saved) pollingPaused = false;
          return saved;
        } catch (error) { return fail(error); }
      });
    },
    dispose() {
      disposed = true;
      clearInterval(poll);
      clearTimeout(timer);
      window.removeEventListener('focus', wake);
      return serial(flushNow);
    },
  };
};
