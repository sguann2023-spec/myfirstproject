import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileBinding } from './fileBinding';
import { buildPartsDocument } from './model';

const file = { path: '/work/sre_demo.json', draftPath: '/work/part_demo.json' };
const parts = [{ id: 'a', start: 0, end: 1000, sourceIndex: 0, blank: false, text: '原文' }];
const recognition = { segments: [], mediaSource: '', parts };
let disk;
let api;
let binding;
let onParts;
let onStatus;
const raw = (next = parts) => JSON.stringify(buildPartsDocument(file, recognition, next));
const changed = (text) => [{ ...parts[0], text }];
const bind = async () => {
  binding = createFileBinding({ file, recognition, api, onParts, onStatus });
  await binding.ready;
};
beforeEach(() => {
  vi.useFakeTimers();
  disk = null;
  onParts = vi.fn();
  onStatus = vi.fn();
  api = {
    fs: { read: vi.fn(async () => {
      if (disk === null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return disk;
    }) },
    file: { write: vi.fn(async (_path, content) => { disk = content; }) },
  };
});
afterEach(async () => {
  await binding?.dispose();
  binding = null;
  vi.useRealTimers();
});
describe('part 文件双向绑定', () => {
  it('首次进入自动创建绑定文件，已有文件则不写入', async () => {
    await bind();
    expect(api.file.write).toHaveBeenCalledOnce();
    expect(JSON.parse(disk).parts[0].text).toBe('原文');
    await binding.dispose();
    api.file.write.mockClear();
    await bind();
    expect(api.file.write).not.toHaveBeenCalled();
    expect(onParts).toHaveBeenCalled();
  });
  it('合并连续编辑，250ms 后自动写入最新版本', async () => {
    await bind();
    binding.update(changed('第一次'));
    binding.update(changed('第二次'));
    await vi.advanceTimersByTimeAsync(250);
    expect(JSON.parse(disk).parts[0].text).toBe('第二次');
    expect(api.file.write).toHaveBeenCalledTimes(2);
  });
  it('外部修改在下一轮检查刷新界面，自身写入不触发回读重置', async () => {
    await bind();
    binding.update(changed('本地'));
    await binding.flush();
    await binding.check();
    expect(onParts).not.toHaveBeenCalled();
    disk = raw(changed('外部'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(onParts.mock.calls.at(-1)[0][0].text).toBe('外部');
  });
  it('外部文件的历史删除标记不进入有效分镜列表，也不覆盖外部文件', async () => {
    await bind();
    const document = JSON.parse(raw());
    document.parts[0].deleted = true;
    disk = JSON.stringify(document);
    const external = disk;
    await binding.check();
    expect(onParts.mock.calls.at(-1)[0]).toEqual([]);
    expect(disk).toBe(external);
    binding.update([]);
    await binding.flush();
    expect(JSON.parse(disk).parts).toEqual([]);
  });
  it('两边同时修改不覆盖磁盘，可选择载入文件', async () => {
    await bind();
    binding.update(changed('本地'));
    disk = raw(changed('外部'));
    expect(await binding.flush()).toBe(false);
    expect(JSON.parse(disk).parts[0].text).toBe('外部');
    expect(onStatus.mock.calls.at(-1)[0].state).toBe('conflict');
    await binding.resolve('disk');
    expect(onParts.mock.calls.at(-1)[0][0].text).toBe('外部');
  });
  it('明确选择本地版本后才覆盖外部变化', async () => {
    await bind();
    binding.update(changed('本地'));
    disk = raw(changed('外部'));
    await binding.flush();
    await binding.resolve('local');
    expect(JSON.parse(disk).parts[0].text).toBe('本地');
  });
  it('损坏或被删除的文件不被自动重建覆盖', async () => {
    await bind();
    disk = '{';
    await binding.check();
    expect(onStatus.mock.calls.at(-1)[0].state).toBe('error');
    expect(disk).toBe('{');
    disk = null;
    expect(await binding.resolve('disk')).toBe(false);
    expect(api.file.write).toHaveBeenCalledOnce();
  });
  it('无效时间不写盘，修正后可重试', async () => {
    await bind();
    binding.update([{ ...parts[0], end: -1 }]);
    expect(await binding.flush()).toBe(false);
    expect(JSON.parse(disk).parts[0].end).toBe(1000);
    binding.update(changed('修复'));
    await binding.resolve('local');
    expect(JSON.parse(disk).parts[0].text).toBe('修复');
  });
  it('外部 JSON 修复后自动恢复读取', async () => {
    await bind();
    disk = '{';
    await binding.check();
    disk = raw(changed('修复后的外部版本'));
    await binding.check();
    expect(onParts.mock.calls.at(-1)[0][0].text).toBe('修复后的外部版本');
    expect(onStatus.mock.calls.at(-1)[0].state).toBe('synced');
  });
  it('写入失败保留最新编辑，关闭 flush 不报告成功', async () => {
    await bind();
    api.file.write.mockRejectedValueOnce(new Error('磁盘已满'));
    binding.update(changed('待保存'));
    expect(await binding.flush()).toBe(false);
    expect(onStatus.mock.calls.at(-1)[0].message).toBe('磁盘已满');
    await binding.resolve('local');
    expect(JSON.parse(disk).parts[0].text).toBe('待保存');
  });
  it('AI执行期间暂停读取半写入文件，结束后校验再应用', async () => {
    await bind();
    binding.pausePolling();
    const previous = onParts.mock.calls.length;
    disk = '{"parts":';
    await vi.advanceTimersByTimeAsync(3000);
    await binding.check();
    expect(onParts.mock.calls).toHaveLength(previous);
    expect(onStatus.mock.calls.at(-1)[0].state).toBe('synced');
    disk = JSON.stringify(buildPartsDocument(file, recognition, changed('AI结果')));
    expect(await binding.resolve('disk', () => { throw new Error('AI格式不符'); })).toBe(false);
    expect(onParts.mock.calls).toHaveLength(previous);
    expect(await binding.resolve('disk', vi.fn())).toBe(true);
    expect(onParts.mock.calls.at(-1)[0][0].text).toBe('AI结果');
    binding.resumePolling();
  });
  it('卸载立即写入待保存内容并停止检查', async () => {
    await bind();
    binding.update(changed('最后修改'));
    await binding.dispose();
    expect(JSON.parse(disk).parts[0].text).toBe('最后修改');
    api.fs.read.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.fs.read).not.toHaveBeenCalled();
  });
  it('写入期间再次编辑仍按顺序写入最新版本', async () => {
    await bind();
    let release;
    api.file.write.mockImplementationOnce((_path, content) => new Promise((resolve) => {
      release = () => { disk = content; resolve(); };
    }));
    binding.update(changed('第一版'));
    const first = binding.flush();
    await vi.advanceTimersByTimeAsync(0);
    binding.update(changed('第二版'));
    release();
    await first;
    await binding.flush();
    expect(JSON.parse(disk).parts[0].text).toBe('第二版');
  });
});
