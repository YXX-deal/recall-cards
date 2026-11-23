# recall-cards（WorkBuddy 版）

把每一次知识点问答变成一张带「提问动机」的知识卡片，自动关联相关旧卡，按遗忘曲线在快忘时抽测。本包是 Qoder 插件 recall-cards 向 **WorkBuddy** 的移植版，核心（卡片存储 / 检索 / 调度 / 图形管理台）与 Qoder 版完全一致，零依赖纯 Node。

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

## 与 Qoder 版的差异

| 项 | Qoder 版 | WorkBuddy 版 |
| --- | --- | --- |
| 入口清单 | `.qoder-plugin/plugin.json` | `SKILL.md` frontmatter + `workbuddy.json`（另附 `.claude-plugin/plugin.json` 兼容 Claude Code） |
| 脚本定位 | `<本Skill目录>` | `${CLAUDE_SKILL_DIR}` |
| 触发 | 斜杠命令 `/recall-cards:on` 等 + 短语 | 自然语言短语（WorkBuddy 技能按 description 触发） |
| 服务自启 | SessionStart hook 自动拉起 | 无 hook，打开管理台时由 `scripts/ensure-ui.mjs` 按需幂等拉起 |
| 界面自启动开关 | 头部「会话自启动」开关 | 已移除（WorkBuddy 无 hook，该开关无意义） |

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

卡片存 `~/.recall-cards/`（环境变量 `RECALL_CARDS_HOME` 可覆盖），与 Qoder 版共用同一份数据目录——同一机器上两个版本打开的是同一个卡片库（服务端按目录单例，不会重复拉起）。卡片只存本地，不写密码/令牌/隐私数据。