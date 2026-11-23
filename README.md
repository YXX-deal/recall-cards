# recall-cards

学习知识卡片插件：**提问即制卡 → 卡片自动关联 → 下次提问先反问，并提醒你当时为什么问**。

日常学习中遇到陌生知识点，问完 AI 就忘，下次又从头问。recall-cards 把每次提问沉淀成一张带「提问动机」的卡片：再次相遇时先唤起场景、考你一次回忆，再给答案。卡片只存本地，复习按遗忘曲线（SM-2 简化版）调度。

## 两个版本

同一套核心，两种宿主各一份，代码互不混合：

| 分支 | 适用宿主 | 入口清单 | 文件数 |
| --- | --- | --- | --- |
| [`workbuddy`](../../tree/workbuddy) | WorkBuddy | `SKILL.md` + `workbuddy.json` | 12 |
| [`qoder`](../../tree/qoder) | Qoder | `.qoder-plugin/plugin.json` + `commands/` + `hooks/` | 17 |

取用方式二选一：

```bash
# 方式一：克隆后切分支
git clone https://github.com/YXX-deal/recall-cards.git
git checkout workbuddy   # 或 qoder

# 方式二：直接下载对应分支的压缩包
# https://github.com/YXX-deal/recall-cards/archive/refs/heads/workbuddy.zip
# https://github.com/YXX-deal/recall-cards/archive/refs/heads/qoder.zip
```

## 安装

**WorkBuddy**：把 `workbuddy` 分支的整个目录放到 `~/.workbuddy/skills/recall-cards/`，重启 WorkBuddy 即在技能列表中出现。零依赖，无需 npm install、无需 MCP。

**Qoder**：把 `qoder` 分支目录打成 zip，在 Qoder 扩展视图选择「安装本地插件」导入。插件自带 SessionStart hook，安装后管理台服务自动常驻。

## 使用

- 进入学习闭环：说「开启卡片记录」或「进入学习卡片模式」（仅当前对话生效）
- 打开管理台：说「打开管理台」，浏览器开 `http://127.0.0.1:47800/`（仅监听本机）
- 复习到期卡片：「帮我复习卡片」；知识图谱：「看看知识图谱」

## 数据

卡片存 `~/.recall-cards/`，可用环境变量 `RECALL_CARDS_HOME` 覆盖。全部数据仅在本机，不上传，不写密码/令牌等敏感信息。

## 许可

MIT，见各分支内的 `LICENSE`。
