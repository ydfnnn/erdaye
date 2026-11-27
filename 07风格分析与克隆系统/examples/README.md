# SC-IMG 教学案例

假想参考描述使用旧港栈桥和海堤值班室两个场景。品牌、人物、资产和实际出图均为空。风格档案为 SP-001@1.0.0，状态 provisional。四个候选核心贯穿案例，细纸粒为有条件的表现。

| 方案 | 风格关系的承担对象 | 输出文件 |
|---|---|---|
| 可复用模板 | {{subject}} 和 {{environment}} 两个槽位 | [规范](reusable.render.json) · [四版提示词](reusable.prompts.json) |
| 同主题变体 | 由港口旧视角切到俯视防波堤灯 | [任务](harbor.task.json) · [规范](harbor.render.json) |
| 相邻主题扩展 | 用低反差岩径引向岔路牌上的局部暖箭头 | [任务](coast.task.json) · [规范](coast.render.json) |
| 跨题材迁移 | 由海雾与灯换成温室玻璃、苗盘和受光的新叶 | [任务](greenhouse.task.json) · [规范](greenhouse.render.json) · [四版提示词](greenhouse.prompts.json) · [待验收记录](greenhouse.review.json) |
| 跨用途海报 | 用抽象纸页、展墙和带局部暖光的标题承担原关系 | [任务](poster.task.json) · [规范](poster.render.json) · [四版提示词](poster.prompts.json) |

新叶案例保留与参考有据的风格规则及项目明确要求的一条主叶脉。海报案例逐字保留原中文标题和日期。它们在两份 JSON 和两份中文文本提示中共用同一原值。系列或真实成图可用验收模板继续记录。

[CASE-0002 信息图形联动示例](./CASE-0002-联动示例.md) 另从本仓库的既有流程案例读数据。用同一教学风格迁移到五阶段流程图，保留阶段文字、主序列和反馈的证据边界。

    node tools/export-prompts.cjs examples/poster.render.json examples/style-profile.json examples/poster.task.json
