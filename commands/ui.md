---
description: 打开卡片管理台（card-ui 的短别名）
---

按 recall-cards Skill 的"图形界面模式"执行：运行 `bin/ensure-ui.mjs` 幂等确保服务，扫 `/api/ping` 确认 url，优先用系统默认浏览器打开并告知用户界面功能。用户要求关闭时按 pid 停止服务进程。