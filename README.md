# recall-cards

把每一次知识点问答变成一张带「提问动机」的知识卡片，自动关联相关旧卡，按遗忘曲线在快忘时抽测。零依赖纯 Node，卡片只存本地。

## 特性

- **存卡带动机**：每张卡记录「当时为什么问」，复习时先唤起场景再提问，知识挂得回原始语境
- **按知识点判重**：同一知识点反复问只保留一张卡，命中则更新补全，不重复堆积
- **自动关联**：新卡与旧卡建立 `前置 / 对比 / 应用 / 相关` 关系，逐步长成知识图谱
- **遗忘曲线调度**：答对 1→3→7→×ease，答得勉强 ×1.2，忘了重置为 1 天并记一次 lapse
- **图形管理台**：多级文件夹、待确认托盘、复习、图谱、统计，仅监听 `127.0.0.1`

## 安装

把整个 `recall-cards/` 文件夹放到 WorkBuddy 的用户技能目录：

```
~/.workbuddy/skills/recall-cards/
```

（Windows 即 `C:\Users\<你>\.workbuddy\skills\recall-cards\`。）放好后**重启 WorkBuddy**，技能会被自动扫描识别（source=userSettings）。无需 models.json 改动、无需 MCP。

## 使用（按对话显式开启）

- 进入学习闭环：在对话里说「开启卡片记录 / 进入学习卡片模式 / 用 recall-cards 学习」。
- 打开图形管理台：说「打开管理台 / 卡片界面」，技能按需拉起本地服务（仅监听 127.0.0.1）并用系统浏览器打开 `http://127.0.0.1:47800/`。
- 复习：说「帮我复习卡片」；图谱：说「看看知识图谱」。
- 关闭：说「关闭卡片模式」停止本对话制卡；说「关闭管理台」结束服务进程。

## 兼容性

| 宿主 | 入口清单 |
| --- | --- |
| WorkBuddy | `SKILL.md` frontmatter + `workbuddy.json` |
| Claude Code | `.claude-plugin/plugin.json` |

脚本定位统一用 `${CLAUDE_SKILL_DIR}`，两种宿主下都能解析。管理台无需 hook，打开时由 `scripts/ensure-ui.mjs` 按需幂等拉起。

## 目录

```
recall-cards/
  SKILL.md                 # 技能入口（闭环规则 + 工具用法）
  workbuddy.json           # WorkBuddy 展示名/描述
  .claude-plugin/plugin.json  # Claude Code 兼容清单（可选）
  scripts/cards.mjs        # 卡片 CLI（零依赖）
  scripts/serve.mjs        # 图形管理台服务（127.0.0.1）
  scripts/ensure-ui.mjs    # 按需幂等确保服务
  assets/ui.html           # 管理台单页界面
  references/card-format.md   # 卡片格式规范
  references/quiz-protocol.md # 反问与评分规则
```

## 数据

卡片存 `~/.recall-cards/`（环境变量 `RECALL_CARDS_HOME` 可覆盖）。服务端按目录单例运行，不会重复拉起。卡片只存本地，不写密码/令牌/隐私数据。

## 许可

MIT，见 [LICENSE](LICENSE)。
