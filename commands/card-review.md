---
description: 复习到期的知识卡片：逐张反问、提醒提问动机、记录复习结果
---

按 recall-cards Skill 的"复习模式"执行：用 `scripts/cards.mjs due` 取到期卡片，逐张按反问协议（先念 motivation 场景，再提回忆性问题，等用户作答后评定并 record）带领用户复习，结束后汇总 good/hard/forgot 数量与明日到期数。没有到期卡片时报告下次到期时间，并询问是否要提前复习全部卡片。