# Builtin Skills Remote Manifest Guide

这份文档说明如何配置远程 `manifest.json`，让客户端在启动后对 builtin skills 执行远程同步。

目标读者：

- 负责发布 OSS 上 skill zip 的同学
- 负责维护 `https://player.install-ai-guider.top/skills/manifest.json` 的同学

本文会结合当前客户端实现，解释：

- 哪些字段是必填
- 哪些字段用于新增 / 更新 / 删除
- 客户端到底信任什么
- 哪些配置会生效，哪些不会

---

## 1. 总体原则

先记住一句话：

**运行时真正生效的不是远程 manifest，而是已经成功安装到 `Data/Skills` 的内容。**

也就是说：

- 远程 `manifest.json` 只是“声明有变化”
- 只有 zip 下载成功并安装成功，新的 skill 版本才算真正生效
- 如果 manifest 已经更新，但 zip 还没下成功，客户端会继续使用本地已经安装好的版本

这套策略的好处：

- 启动不被远程下载阻塞
- 远程失败不会影响当前已经可用的 skill
- 远程 manifest 可以安全地作为“更新指令”

---

## 2. 客户端优先级

客户端在 builtin skills 上的优先级如下：

1. 优先使用已经安装在 `Data/Skills` 的 skill
2. 如果某个 builtin skill 在 `Data/Skills` 中不存在，才用本地 `resources/skills` 做兜底安装
3. 启动后后台拉远程 manifest，执行新增 / 更新 / 删除同步
4. 新 session 启动前，再把当前 agent 已启用的 skill 从 `Data/Skills` 懒同步到 workspace

所以请注意：

- **manifest 本身不是生效真相**
- **zip 下载成功并安装到 `Data/Skills` 后，才算切换成功**

---

## 3. 远程 manifest 地址

当前客户端固定拉取：

```text
https://player.install-ai-guider.top/skills/manifest.json
```

每个 skill 的 zip 下载地址也通常放在同一个 OSS 域名下，**强烈建议使用带版本目录的不可变地址**，例如：

```text
https://player.install-ai-guider.top/skills/vectcut-skill/1_5_9/vectcut-skill.zip
https://player.install-ai-guider.top/skills/find-skills/1_0_0/find-skills.zip
https://player.install-ai-guider.top/skills/storyboard-skill/1_0_0/storyboard-skill.zip
```

推荐规则：

- 一个版本对应一个固定 zip 地址
- 不要让新包覆盖旧版本 zip
- 版本号中的 `.` 可统一替换成 `_`，例如 `1.5.9 -> 1_5_9`
- 这样可以保留历史版本，方便回滚和排查问题

---

## 4. manifest 顶层结构

推荐结构如下：

```json
{
  "updatedAt": "2026-05-13T10:00:00Z",
  "skills": {
    "vectcut-skill": {
      "version": "1.2.0",
      "downloadUrl": "https://player.install-ai-guider.top/skills/vectcut-skill/1_2_0/vectcut-skill.zip",
      "minAppVersion": "1.5.0"
    }
  }
}
```

字段说明：

- `updatedAt`
  - 可选
  - 表示本次 manifest 最近更新时间
  - 推荐使用 ISO 时间字符串

- `skills`
  - 必填
  - key 是 skill 的目录名，也就是最终安装到 `Data/Skills/<folderName>` 的名字
  - 例如：`vectcut-skill`、`find-skills`

---

## 5. 单个 skill 条目字段

### 5.1 常规更新字段

用于“新增 skill”或“更新 skill”的字段：

```json
{
  "version": "1.2.0",
  "downloadUrl": "https://player.install-ai-guider.top/skills/vectcut-skill/1_2_0/vectcut-skill.zip",
  "minAppVersion": "1.5.0",
  "autoEnableExistingAgents": true
}
```

字段含义：

- `version`
  - 可选但通常必填
  - skill 自己的版本号
  - 推荐使用 semver，如 `1.0.0`、`1.2.3`
  - 客户端会用它和本地 `.version` 比较

- `downloadUrl`
  - 可选但通常必填
  - skill zip 的下载地址
  - 只有当 `version + downloadUrl` 都存在时，客户端才会把该条目当成“可安装/可更新”

- `minAppVersion`
  - 可选
  - 只有客户端版本大于等于这个值时，才会应用这次远程变更
  - 推荐使用 semver

- `autoEnableExistingAgents`
  - 可选
  - 当前客户端默认值是 `true`
  - 对“远程新增 builtin skill”特别有用
  - 当某个 skill 本地原本不存在、这次是通过远程首次安装时，如果该字段为 `true` 或未填写，客户端会自动给已有 agent 启用

---

### 5.2 删除字段

用于“远程删除 skill”的字段：

```json
{
  "deleted": true,
  "tombstoneVersion": "2.0.0",
  "minAppVersion": "1.5.0"
}
```

字段含义：

- `deleted`
  - 表示该 skill 需要被远程删除
  - 客户端收到后会删除：
    - `Data/Skills/<skill>`
    - 所有 agent workspace 中该 skill 的副本

- `tombstoneVersion`
  - 删除墓碑版本号
  - 用来防止 skill 被本地 `resources/skills` 重新装回来
  - 推荐每次删除动作都给一个更高的新值
  - 推荐也使用 semver，例如 `2.0.0`

- `minAppVersion`
  - 表示只有某些客户端版本以上才执行删除

---

## 6. 三种典型操作

### 6.1 新增一个 builtin skill

场景：

- OSS 上新上传了一个此前客户端完全没有的 builtin skill
- 希望客户端下次启动时能后台拉到，并自动给已有 agent 启用

manifest 示例：

```json
{
  "updatedAt": "2026-05-20T09:00:00Z",
  "skills": {
    "storyboard-skill": {
      "version": "1.0.0",
      "downloadUrl": "https://player.install-ai-guider.top/skills/storyboard-skill.zip",
      "minAppVersion": "1.5.0",
      "autoEnableExistingAgents": true
    }
  }
}
```

客户端行为：

1. 启动后后台拉到 manifest
2. 发现 `storyboard-skill` 本地不存在
3. 下载 zip
4. 安装到 `Data/Skills/storyboard-skill`
5. 安装成功后，自动分发给已有 agent
6. 下次启动或新 session 时开始生效

注意：

- 如果 zip 下载失败，这个 skill 不会生效
- manifest 有条目但 zip 失败，不会造成半安装状态

---

### 6.2 更新一个已有 builtin skill

场景：

- `vectcut-skill` 已经存在
- 希望远程升级到更高版本

manifest 示例：

```json
{
  "updatedAt": "2026-05-21T10:00:00Z",
  "skills": {
    "vectcut-skill": {
      "version": "1.3.0",
      "downloadUrl": "https://player.install-ai-guider.top/skills/vectcut-skill.zip",
      "minAppVersion": "1.5.0"
    }
  }
}
```

客户端行为：

1. 读取本地 `Data/Skills/vectcut-skill/.version`
2. 如果本地版本低于 `1.3.0`
3. 下载 zip
4. 安装成功后覆盖 `Data/Skills/vectcut-skill`
5. 写入新的 `.version`
6. 后续新 session 启动时，已启用该 skill 的 agent 会按版本懒同步到 workspace

注意：

- 当前客户端不会因为“manifest 变了”就立刻切换使用远程版本
- 一定要等 zip 下载并安装成功

---

### 6.3 删除一个 builtin skill

场景：

- 希望把 `find-skills` 从 builtin skills 中下线

manifest 示例：

```json
{
  "updatedAt": "2026-05-22T11:00:00Z",
  "skills": {
    "find-skills": {
      "deleted": true,
      "tombstoneVersion": "2.0.0",
      "minAppVersion": "1.5.0"
    }
  }
}
```

客户端行为：

1. 启动后后台拉到 manifest
2. 识别到 `find-skills.deleted = true`
3. 删除 `Data/Skills/find-skills`
4. 删除所有 agent workspace 中的 `find-skills`
5. 在本地同步状态中写入 tombstone
6. 后续即使本地 `resources/skills/find-skills` 还存在，也不会再自动装回

注意：

- **删除必须显式写 `deleted: true`**
- 仅仅把某个 skill 从 manifest 里删掉，不会触发自动删除

这样设计是为了安全：

- 防止因为 manifest 发布错误，误删大量 skill

---

## 7. “删除”为什么需要 tombstone

很多人第一次配远程删除时会疑惑：

“既然都删掉了，为什么还要 `tombstoneVersion`？”

原因是：

- 客户端本地还带着 `resources/skills/<skill>`
- 如果远程删除后没有本地 tombstone 记录
- 那下次远程请求失败时，客户端会以为这个 skill 是本地缺失，于是又从 `resources/skills` 装回来

所以：

- `deleted: true` 是“这次要删”
- `tombstoneVersion` 是“以后也别自动复活”

---

## 8. 推荐发布规范

### 8.1 新增或更新 skill 时

建议流程：

1. 先打包 zip
2. 上传到带版本目录的 OSS 路径，例如 `skills/vectcut-skill/1_5_9/vectcut-skill.zip`
3. 确认 zip 地址可访问
4. 再更新远程 `manifest.json`

不要反过来做：

- 先改 manifest
- 再慢慢上传 zip

否则客户端可能先看到新版本，但下载时拿不到 zip，导致这一轮更新失败

---

### 8.2 删除 skill 时

建议流程：

1. 先在远程 manifest 中配置 `deleted: true`
2. 给出新的 `tombstoneVersion`
3. 保持一段时间，确保大部分客户端都能同步删除
4. 再决定是否从 OSS 上清理旧 zip

不建议直接先删 zip 再改 manifest，因为：

- 还没同步到删除指令的客户端可能仍会尝试拉旧版本

---

## 9. 推荐版本号规则

建议统一使用 semver：

```text
1.0.0
1.0.1
1.1.0
2.0.0
```

推荐约定：

- `patch`：小修复，如文案、规则、小脚本变更
- `minor`：新增能力、增强流程
- `major`：不兼容变更，或删除重做

删除墓碑版本 `tombstoneVersion` 也建议沿用 semver，例如：

```text
2.0.0
999.0.0
```

其中：

- 如果只是正常删除，可以用一个正常递增版本
- 如果你想确保以后所有旧版本都被 tombstone 压住，也可以用明显更大的值

---

## 10. 常见错误配置

### 错误 1：只有 version，没有 downloadUrl

```json
{
  "skills": {
    "vectcut-skill": {
      "version": "1.2.0"
    }
  }
}
```

问题：

- 客户端不会执行安装，因为没有 zip 下载地址

---

### 错误 2：只把 skill 从 manifest 删掉，想让客户端自动删除

错误示例：

```json
{
  "skills": {
    "vectcut-skill": {
      "version": "1.2.0",
      "downloadUrl": "https://player.install-ai-guider.top/skills/vectcut-skill.zip"
    }
  }
}
```

问题：

- `find-skills` 不在 manifest 中，不代表删除
- 客户端不会因此卸载它

正确做法是：

```json
{
  "skills": {
    "find-skills": {
      "deleted": true,
      "tombstoneVersion": "2.0.0"
    }
  }
}
```

---

### 错误 3：manifest 已更新，但 zip 还没上传好

问题：

- 客户端看到有新版本，会尝试下载
- 如果此时 zip 404 或权限错误，这一轮升级会失败
- 但不会导致旧版本失效

建议：

- 总是先上传 zip，再发 manifest

---

## 11. 一个完整示例

下面这个例子同时包含：

- 更新 `vectcut-skill`
- 删除 `find-skills`
- 新增 `storyboard-skill`

```json
{
  "updatedAt": "2026-05-25T12:00:00Z",
  "skills": {
    "vectcut-skill": {
      "version": "1.4.0",
      "downloadUrl": "https://player.install-ai-guider.top/skills/vectcut-skill.zip",
      "minAppVersion": "1.5.0"
    },
    "find-skills": {
      "deleted": true,
      "tombstoneVersion": "2.0.0",
      "minAppVersion": "1.5.0"
    },
    "storyboard-skill": {
      "version": "1.0.0",
      "downloadUrl": "https://player.install-ai-guider.top/skills/storyboard-skill.zip",
      "minAppVersion": "1.5.0",
      "autoEnableExistingAgents": true
    }
  }
}
```

对应结果：

- `vectcut-skill`：如果本地旧，就会下载新 zip 覆盖安装
- `find-skills`：会被卸载，并写 tombstone，避免本地基线复活
- `storyboard-skill`：会被下载安装，并自动给已有 agent 启用

---

## 12. 本地 manifest 和远程 manifest 的关系

本地文件：

```text
resources/skills/manifest.json
```

作用：

- 仅作为本地 bundle 的兜底元信息
- 主要用于首次安装或远程失败时做 fallback

远程文件：

```text
https://player.install-ai-guider.top/skills/manifest.json
```

作用：

- 用于后台同步 builtin skills 的新增 / 更新 / 删除

推荐做法：

- 本地 manifest 通常维护基础字段：`version`、`downloadUrl`、`minAppVersion`
- 如果某个 skill 已经明确下线，本地 manifest 也可以直接保留 `deleted`、`tombstoneVersion`，避免基线包和远程策略不一致
- 远程 manifest 可以在此基础上增加 `deleted`、`tombstoneVersion`、`autoEnableExistingAgents`

---

## 13. 最小可用模板

如果你只想快速发布一个最小版本，下面这个模板就够：

```json
{
  "updatedAt": "2026-05-13T10:00:00Z",
  "skills": {
    "find-skills": {
      "version": "1.0.0",
      "downloadUrl": "https://player.install-ai-guider.top/skills/find-skills/1_0_0/find-skills.zip",
      "minAppVersion": "0.0.0"
    },
    "storyboard-skill": {
      "version": "1.0.0",
      "downloadUrl": "https://player.install-ai-guider.top/skills/storyboard-skill/1_0_0/storyboard-skill.zip",
      "minAppVersion": "0.0.0"
    },
    "vectcut-skill": {
      "version": "1.0.0",
      "downloadUrl": "https://player.install-ai-guider.top/skills/vectcut-skill/1_0_0/vectcut-skill.zip",
      "minAppVersion": "0.0.0"
    }
  }
}
```

---

每次发 manifest 前，建议检查：

- skill 名称是否和 zip 内目录名一致
- `downloadUrl` 是否可访问
- `version` 是否正确递增
- `minAppVersion` 是否合理
- 删除动作是否带了 `deleted: true`
- 删除动作是否带了新的 `tombstoneVersion`
- 新增 skill 是否确认要自动给已有 agent 启用

---

## 15. 一句话总结

可以把远程 manifest 理解成：

- **新增/更新：给客户端下载 zip 的指令**
- **删除：给客户端下载 tombstone 并执行卸载的指令**

真正决定运行时内容的，始终是：

```text
Data/Skills
```
