# 2026-10-15 客户端崩溃邮件分析

来源：本机 Documents/邮件10-15 中 94 封 EML，解析其 ZIP 内的 report.json、diagnostic.log 与 dump。邮件和日志内容仅作为诊断数据。原始材料未修改，解包文件保存在 /tmp/capcut-crash-1015。

## 范围与统计

- 全部为 Windows x64；版本 1.7.6（4）、1.7.8（1）、1.7.9（26）、1.7.10（1）、1.7.13（44）、1.7.16（5）、1.7.17（5）、1.7.18（8）。这是报告数量，不能推导版本崩溃率或用户数量。
- 会话开始时间覆盖 2026-09-29 至 2026-10-14 UTC，并非全是 10 月 15 日发生。
- 邮件分类：process-crash 64，crash-dump 30。
- 按报告去重：渲染进程 crashed 35，GPU crashed 33，渲染进程 oom 3，渲染进程 killed 且 exitCode=1073807364 为 33。类别相互重叠，不能相加。
- 同一渲染进程故障由全局监听和窗口监听各记录一次，所以原始事件数不能当成崩溃次数。
- dump 附件元数据：29 个因大小限制省略，15 个标为 attached。实际附件中有一个空文件；其余仅解析异常记录，未做符号化。异常码分布：0xe0000008（7）、0x0517a7ed（4）、0x0（2）、0xc000001d（1）。单凭异常码不能定位业务代码。

## 有证据的异常与建议

### 局域网发现定时器未捕获异常

报告 879869f7-c8d6-4d2e-843f-b20a94479cd9（1.7.13）包含主进程 uncaught-exception：ERR_SYSTEM_ERROR，调用链为 node:os networkInterfaces → multicast-dns allInterfaces → update 定时器。它出现在一次 renderer oom 后约 47 秒，随后 renderer 再次 oom；不能认定网络异常导致了 OOM。

当前 LocalTransferService 用 bonjour-service，传递依赖 multicast-dns@7.2.5 的 update 仍直接调用 allInterfaces，没有捕获其异常。应用已有启动 try/catch 和 browser error 监听，但捕获不到这个独立定时器抛出的异常。

建议为 multicast-dns 制作受版本控制的依赖补丁：只在枚举接口失败时捕获异常并报告 warning，保留已有 membership，等待下次周期重试。不要用全局替换 os.networkInterfaces 的办法。还应让停止发现时释放 Bonjour 实例，避免停扫后仍运行接口轮询；这只能缩小暴露窗口，不能单独解决扫描期间的异常。需要增加模拟接口枚举失败和随后恢复的验证。

### Windows 进程终止与恢复退出

33 份报告含 killed/1073807364；部分明确记录 query-session-end/session-end。不能据此将全部 33 份判定为正常关机，也不能将其全部视为业务崩溃。31 份报告记录 renderer-recovery-action exit，说明部分用户看到的整机应用退出来自应用主动 app.exit(1)，不是主进程原生崩溃。

当前 WindowService 已有退出期间跳过恢复、延迟 100ms reload 的处理；旧报告中的恢复流程未必对应当前代码。建议先验证最新版本在 Windows 注销/关机及 renderer reload 时的行为，再决定是否改变一分钟内第二次故障就退出的策略。延迟 reload 不能证明已解决首次故障。

### 内存不足

明确 oom 的报告：879869f7…（1.7.13）、fae2007b…（1.7.13）、73e90087…（1.7.18）。后者启动约 8 秒便 OOM。现有故障发生后的 rendererPid=0，processMetrics 已没有故障渲染进程，不能用主进程 heapUsed 推断渲染进程没有内存问题。

建议补充故障前渲染进程的内存趋势、系统可用内存/提交内存、启动恢复的会话与附件数量，结合对应版本重现。暂不提高 V8 堆上限或清空用户历史数据。

### GPU / 原生进程故障

GPU 的退出码包括 34、-2147483645、-1073741205 等；渲染进程还有 -1073741205、-1、-1073741795。现有数据缺少显卡型号、驱动版本以及符号化原生栈，无法区分驱动、Chromium、系统资源或外部进程干预。

建议补充 GPU 信息，并对重复故障设备做关闭硬件加速的对照。不要直接全局禁用硬件加速。对被省略的 dump 可采用单独上传或压缩保留方式，需要先确定存储与采集方案。

### 请求错误未处理

3 份报告共 8 条 unhandled-rejection：7 条点数不足，1 条 draft-download MCP 参数 schema 被服务端拒绝。它们不是原生崩溃的直接证据。当前 claudecode 服务的 processPiHarnessQuery 调用已挂 catch，并把点数不足转成用户提示；本批旧版本报告不能证明当前仍有相同拒绝遗漏。建议在最新版本复现点数不足和非法 schema，确认没有额外的 Promise 分支遗漏后再改动。

## 本次处理

未修改运行时代码，也未运行测试。异常位置可以确认，但现有证据不足以选择一项能够安全证明修复崩溃的业务改动。优先建议确认 multicast-dns 的局部依赖补丁，其次补充 GPU / 内存诊断并验证当前 Windows 恢复策略。
