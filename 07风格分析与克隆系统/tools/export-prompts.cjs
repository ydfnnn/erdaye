'use strict';

const fs = require('node:fs');

const VERSION = '1.0.0';
const fieldsBySection = {
  style: ['narrative_stance', 'identity', 'artist_reference', 'movement', 'line_quality', 'color_palette',
    'light_logic', 'rendering_style', 'space_treatment', 'edge_control', 'finish_control', 'texture', 'detail_density'],
  character: ['subject', 'identity', 'form', 'quantity', 'face', 'posture', 'action', 'expression', 'gaze',
    'costume', 'distinctive_feature', 'assets'],
  environment: ['setting', 'time', 'atmosphere', 'depth_structure', 'scale', 'relation_to_subject'],
  narrative: ['intent', 'subject_scene_relation', 'tension', 'visual_path', 'anchor_point', 'lingering_question'],
  mood: ['primary', 'secondary', 'complexity', 'visual_cues'],
  technical: ['composition', 'shot_type', 'protected_items', 'negative_constraints']
};
const priorities = ['must', 'should', 'may'];
const outputKeys = ['count', 'aspect_ratio', 'dimensions_px', 'format'];
const idPattern = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const slotPattern = /^[a-z][a-z0-9_]*$/;
const ratioPattern = /^[1-9]\d*:[1-9]\d*$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function ids(values, label, pattern = idPattern) {
  assert(Array.isArray(values) && values.every(value => typeof value === 'string' && pattern.test(value)),
    label + ' 须为合法标识数组');
  const unique = new Set(values);
  assert(unique.size === values.length, label + ' 包含重复标识');
  return unique;
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every(value => right.has(value));
}

function requireSubset(left, right, label) {
  const missing = [...left].filter(value => !right.has(value));
  assert(missing.length === 0, label + '：' + missing.join('、'));
}

function ref(value, label) {
  assert(isObject(value) && hasText(value.id) && idPattern.test(value.id) &&
    hasText(value.version) && versionPattern.test(value.version), label + ' 须含有效 ID 和版本');
}

function checkRef(target, record, label) {
  ref(record, label);
  assert(record.id === target.id && record.version === target.version, label + ' 与指定版本不一致');
}

function readSlots(content, label) {
  const names = new Set([...content.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map(match => match[1]));
  const remaining = content.replace(/\{\{[a-z][a-z0-9_]*\}\}/g, '');
  assert(!remaining.includes('{{') && !remaining.includes('}}'), label + ' 存在无法解析的槽位');
  return names;
}

function checkOutput(output) {
  assert(isObject(output), 'output 须为对象');
  assert(output.count === null || positiveInteger(output.count), 'output.count 须为正整数或 null');
  assert(output.aspect_ratio === null || (hasText(output.aspect_ratio) && ratioPattern.test(output.aspect_ratio)),
    'output.aspect_ratio 须采用宽:高或 null');
  const size = output.dimensions_px;
  assert(size === null || (isObject(size) && positiveInteger(size.width) && positiveInteger(size.height)),
    'output.dimensions_px 须含正整数 width 与 height，或为 null');
  if (output.aspect_ratio !== null && size !== null) {
    const [widthRatio, heightRatio] = output.aspect_ratio.split(':').map(BigInt);
    const crossDifference = BigInt(size.width) * heightRatio - BigInt(size.height) * widthRatio;
    const difference = crossDifference < 0n ? -crossDifference : crossDifference;
    const rounding = widthRatio > heightRatio ? widthRatio : heightRatio;
    assert(difference * 2n <= rounding, '画幅与宽高像素尺寸不一致');
  }
  assert(output.format === null || hasText(output.format), 'output.format 须为非空字符串或 null');
}

function checkExactText(requirements) {
  assert(isObject(requirements) && ['none', 'exact', 'unspecified'].includes(requirements.mode),
    'text_requirements.mode 无效');
  const lines = requirements.exact_text;
  assert(Array.isArray(lines) && lines.every(hasText), 'exact_text 须为非空字符串组成的数组');
  assert(requirements.mode === 'exact' ? lines.length > 0 : lines.length === 0,
    '仅 exact 模式应包含准确文案，且至少填写一项');
}

function uniqueRecords(list, label) {
  assert(Array.isArray(list) && list.every(isObject), label + ' 须为对象数组');
  ids(list.map(item => item.id), label);
  return new Map(list.map(item => [item.id, item]));
}

function validateProfile(profile, specification, coverage) {
  checkRef(specification.profile_ref, profile, '风格档案');
  const coreIds = ids(profile.core_rule_ids, '档案 core_rule_ids');
  assert(sameSet(coreIds, coverage.core), '核心规则清单与风格档案不一致');
  const rules = uniqueRecords(profile.rules, '档案规则');
  const declaredIds = new Set(rules.keys());
  requireSubset(coverage.core, declaredIds, '档案未定义核心规则');
  requireSubset(coverage.active, declaredIds, '档案未定义采用规则');
  requireSubset(coverage.excluded, declaredIds, '档案未定义排除规则');
  const codedCore = new Set([...rules].filter(([, rule]) => rule.variability === 'core').map(([id]) => id));
  assert(sameSet(coreIds, codedCore), '风格档案的核心清单与规则变化属性不一致');
  for (const id of coverage.active) {
    const rule = rules.get(id);
    assert(rule.category === 'style' && priorities.includes(rule.priority), '风格规则缺少类别或优先级：' + id);
    const dependencies = ids(rule.requires, '依赖 ' + id);
    const conflicts = ids(rule.excludes, '冲突 ' + id);
    requireSubset(dependencies, coverage.active, '采用 ' + id + ' 时缺少依赖规则');
    requireSubset(conflicts, declaredIds, '档案未定义冲突规则');
    assert([...conflicts].every(conflict => !coverage.active.has(conflict)), '采用规则存在冲突：' + id);
    if (rule.priority === 'must') assert(coverage.required.has(id), '必须风格规则未进入 must 条款：' + id);
  }
}

function compareOutput(task, specification) {
  checkOutput(task.output);
  checkExactText(task.text_requirements);
  for (const key of outputKeys) {
    const expected = task.output[key];
    if (expected === null) continue;
    const actual = specification.output[key];
    const matches = key === 'dimensions_px'
      ? actual?.width === expected.width && actual?.height === expected.height
      : actual === expected;
    assert(matches, '规格与项目任务不一致：' + key);
  }
  if (task.text_requirements.mode !== 'unspecified') {
    const { mode, exact_text: expected } = task.text_requirements;
    const actual = specification.text_requirements;
    assert(actual.mode === mode && actual.exact_text.length === expected.length &&
      expected.every((line, i) => line === actual.exact_text[i]), '精确文字与项目任务不一致');
  }
}

function validateTask(task, specification, requiredLocks) {
  assert(specification.scope === 'task', 'style_only 规范可独立导出');
  checkRef(specification.task_ref, task, '项目任务');
  checkRef(specification.profile_ref, task.profile_ref, '项目的风格引用');
  const locks = uniqueRecords(task.project_locks, '项目锁定');
  const declaredIds = new Set(locks.keys());
  const declaredRequired = new Set([...locks].filter(([, lock]) => lock.priority === 'must').map(([id]) => id));
  assert(sameSet(requiredLocks, declaredRequired), '必须项目锁定清单与任务不一致');
  for (const item of specification.items) {
    requireSubset(new Set(item.source_lock_ids), declaredIds, '任务未定义项目锁定');
  }
  compareOutput(task, specification);
}

function validate(specification, profile, task) {
  assert(isObject(specification) && specification.schema_version === VERSION, 'render_spec 规范版本无效');
  ids([specification.id], 'render_spec.id');
  const { scope, profile_ref: profileRef, task_ref: taskRef } = specification;
  assert(['style_only', 'task'].includes(scope), 'scope 须为 style_only 或 task');
  ref(profileRef, 'profile_ref');
  if (scope === 'task') ref(taskRef, 'task_ref');
  else assert(taskRef === null, 'style_only 的 task_ref 须为 null');

  const core = ids(specification.core_style_rule_ids, '核心规则');
  const active = ids(specification.active_style_rule_ids, '采用规则');
  const locks = ids(specification.required_project_lock_ids, '必须项目锁定');
  const slots = ids(specification.slots, '槽位', slotPattern);
  assert(scope === 'task' ? slots.size === 0 : slots.size > 0, '任务版清空槽位，通用版登记槽位');
  if (scope === 'style_only') assert(locks.size === 0, '通用版的项目锁定清单须为空');
  const exclusions = specification.rule_exclusions;
  assert(Array.isArray(exclusions) && exclusions.every(item => isObject(item) && hasText(item.reason)),
    'rule_exclusions 每项须有 rule_id 和理由');
  const excluded = ids(exclusions.map(item => item.rule_id), '排除规则');
  requireSubset(core, new Set([...active, ...excluded]), '核心规则缺少采用记录或适用性理由');
  assert([...excluded].every(id => !active.has(id)), '同一规则同时采用和排除');
  checkOutput(specification.output);
  checkExactText(specification.text_requirements);

  const items = uniqueRecords(specification.items, '生成条款');
  const visited = new Set();
  const required = new Set();
  const coveredLocks = new Set();
  const usedSlots = new Set();
  const mustSlots = new Set();
  let hasSubject = false;
  for (const [id, item] of items) {
    assert(Object.hasOwn(fieldsBySection, item.section) && fieldsBySection[item.section].includes(item.field),
      '生成条款字段无效：' + id);
    assert(priorities.includes(item.priority), '生成条款优先级无效：' + id);
    assert(isObject(item.text) && hasText(item.text.zh) && hasText(item.text.en), '缺少双语条款：' + id);
    const sourceIds = ids(item.source_rule_ids, '原规则 ' + id);
    const lockIds = ids(item.source_lock_ids, '原锁定 ' + id);
    requireSubset(sourceIds, active, '引用了未启用的风格规则');
    if (scope === 'style_only') assert(lockIds.size === 0, '通用版条款应无项目锁定');
    const zhSlots = readSlots(item.text.zh, id + ' 中文');
    const enSlots = readSlots(item.text.en, id + ' 英文');
    assert(sameSet(zhSlots, enSlots), '中英文槽位不一致：' + id);
    for (const ruleId of sourceIds) visited.add(ruleId);
    for (const slot of zhSlots) usedSlots.add(slot);
    if (item.priority === 'must') {
      for (const ruleId of sourceIds) required.add(ruleId);
      for (const lockId of lockIds) coveredLocks.add(lockId);
      for (const slot of zhSlots) mustSlots.add(slot);
      if (item.section === 'character' && item.field === 'subject') hasSubject = true;
    }
  }
  assert(hasSubject, '需要一条 must 主体或主体槽位');
  assert(sameSet(usedSlots, slots), '生成条款中的槽位与声明不一致');
  assert(sameSet(mustSlots, slots), '所有声明槽位须进入 must 条款，以便四版均可填写');
  requireSubset(active, visited, '采用规则没有映射到任何生成条款');
  requireSubset(new Set([...core].filter(id => active.has(id))), required, '已启用核心未进入 must 条款');
  requireSubset(locks, coveredLocks, '必须项目锁定未进入 must 条款');
  if (profile) validateProfile(profile, specification, { core, active, excluded, required });
  if (task) validateTask(task, specification, locks);
}

function makeJSON(specification, locale) {
  const prompt = Object.fromEntries(Object.keys(fieldsBySection).map(key => [key, {}]));
  for (const item of specification.items) {
    const section = prompt[item.section];
    (section[item.field] ??= []).push({ id: item.id, priority: item.priority, text: item.text[locale] });
  }
  const output = Object.fromEntries(outputKeys.flatMap(key => {
    const value = specification.output[key];
    if (value === null) return [];
    if (key === 'dimensions_px') return [[key, { width: value.width, height: value.height }]];
    return [[key, value]];
  }));
  if (Object.keys(output).length) prompt.technical.output = output;
  const { mode, exact_text: exactText } = specification.text_requirements;
  if (mode !== 'unspecified') prompt.technical.text_requirements = { mode, exact_text: [...exactText] };
  return prompt;
}

function sharedConstraints(specification) {
  const { count, aspect_ratio: ratio, dimensions_px: size, format } = specification.output;
  const { mode, exact_text: exactText } = specification.text_requirements;
  const constraints = [];
  if (count !== null) constraints.push('输出 ' + count + ' 张图');
  if (ratio !== null) constraints.push('画幅 ' + ratio);
  if (size !== null) constraints.push('尺寸 ' + size.width + ' × ' + size.height + ' 像素');
  if (format !== null) constraints.push('文件格式 ' + format);
  if (mode === 'none') constraints.push('画面无文字');
  if (mode === 'exact') {
    constraints.push('画面逐字呈现 ' + exactText.map(line => JSON.stringify(line)).join('、') + '，外侧引号仅用于划分条目');
  }
  return constraints;
}

function sentence(text) {
  const trimmed = text.trim();
  return /[。！？.!?]$/.test(trimmed) ? trimmed : trimmed + '。';
}

function makeText(specification, compact) {
  const groupOrder = ['character', 'environment', 'style', 'narrative', 'mood', 'technical'];
  const paragraphs = [];
  for (const section of groupOrder) {
    const group = specification.items.filter(item => item.section === section && (!compact || item.priority === 'must'));
    const sentences = group.map(item => {
      const prefix = item.priority === 'must' ? '' : item.priority === 'should' ? '优先采用。' : '可选。';
      return prefix + sentence(item.text.zh);
    });
    if (sentences.length) paragraphs.push(sentences.join(''));
  }
  const shared = sharedConstraints(specification);
  if (shared.length) paragraphs.push(shared.map(sentence).join(''));
  return paragraphs.join(compact ? '' : '\n\n');
}

function exportPrompts(specification, profile, task) {
  validate(specification, profile, task);
  return {
    zh_json: makeJSON(specification, 'zh'),
    en_json: makeJSON(specification, 'en'),
    zh_simple: makeText(specification, true),
    natural_language_zh: makeText(specification, false)
  };
}

function readJSON(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
}

if (require.main === module) {
  try {
    const [specification, profile, task, ...extra] = process.argv.slice(2);
    assert(specification && !extra.length,
      '使用方法 node tools/export-prompts.cjs <render-spec.json> [style-profile.json] [image-task.json]');
    const bundle = exportPrompts(readJSON(specification), profile && readJSON(profile), task && readJSON(task));
    process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('导出失败。' + error.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { exportPrompts, fieldsBySection, priorities, outputKeys, idPattern, versionPattern, slotPattern, ratioPattern, VERSION };
