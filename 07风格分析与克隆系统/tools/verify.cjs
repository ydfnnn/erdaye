'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { exportPrompts, fieldsBySection, VERSION } = require('./export-prompts.cjs');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const json = name => JSON.parse(read(name));
const sample = name => json('examples/' + name + '.render.json');
const task = name => json('examples/' + name + '.task.json');
const profile = json('examples/style-profile.json');
const manifest = json('manifest.json');
const languageKeys = ['zh_json', 'en_json', 'zh_simple', 'natural_language_zh'];
const sectionKeys = Object.keys(fieldsBySection);

assert.equal(manifest.system_id, 'sc-img');
assert.equal(manifest.version, VERSION);
assert.deepEqual(manifest.outputs, languageKeys);
assert.match(read(manifest.entry), new RegExp('规范版本 ' + VERSION.replaceAll('.', '\\.') + '(?:\\s|$)'));
assert.ok(read(manifest.entry).trimEnd().endsWith(manifest.entry_end_marker));
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, manifest.entry))).digest('hex'),
  manifest.entry_sha256, '运行正文应与 manifest 中的摘要一致');
assert.ok(read(manifest.memory_card).includes('系统版本　' + VERSION));
const schema = json(manifest.schema);
assert.equal(schema.properties.schema_version.const, VERSION);
const supported = schema.properties.items.items.allOf.map(entry => [
  entry.if.properties.section.const, entry.then.properties.field.enum
]);
assert.deepEqual(Object.fromEntries(supported), fieldsBySection);
assert.ok(read('DESIGN.md').includes('VSCF'));

const moduleNames = ['A1', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D1', 'E1', 'E2', 'E3'];
assert.deepEqual(Object.keys(profile.modules), moduleNames);
assert.deepEqual(Object.keys(json('templates/style-profile.template.json').modules), moduleNames);
assert.equal(profile.status, 'provisional');
const referenceIds = new Set(profile.references.map(reference => reference.id));
const evidenceIds = new Set(profile.evidence.map(evidence => evidence.id));
for (const evidence of profile.evidence) {
  for (const id of evidence.reference_ids) assert.ok(referenceIds.has(id), id);
}
for (const rule of profile.rules) {
  assert.ok(profile.modules[rule.module].rule_ids.includes(rule.id));
  for (const id of rule.evidence_ids) assert.ok(evidenceIds.has(id), id);
}

function renderCheck(spec, selectedTask) {
  const result = exportPrompts(spec, profile, selectedTask);
  assert.deepEqual(Object.keys(result), languageKeys);
  assert.deepEqual(Object.keys(result.zh_json), sectionKeys);
  assert.deepEqual(Object.keys(result.en_json), sectionKeys);
  for (const section of sectionKeys) {
    assert.deepEqual(Object.keys(result.zh_json[section]), Object.keys(result.en_json[section]), section);
  }
  assert.deepEqual(result.zh_json.technical.output, result.en_json.technical.output);
  assert.deepEqual(result.zh_json.technical.text_requirements, result.en_json.technical.text_requirements);
  for (const item of spec.items) {
    const { id, section, field, priority, text } = item;
    const zh = result.zh_json[section][field].find(value => value.id === id);
    const en = result.en_json[section][field].find(value => value.id === id);
    assert.deepEqual(zh, { id, priority, text: text.zh });
    assert.deepEqual(en, { id, priority, text: text.en });
    assert.ok(result.natural_language_zh.includes(text.zh));
    assert.equal(result.zh_simple.includes(text.zh), priority === 'must', '简版条款优先级 ' + id);
  }
  if (spec.scope === 'style_only') {
    for (const slot of spec.slots) {
      const occurrence = '{{' + slot + '}}';
      for (const value of Object.values(result)) assert.ok(JSON.stringify(value).includes(occurrence));
    }
  } else {
    assert.ok(!JSON.stringify(result).includes('{{'));
  }
  for (const literal of spec.text_requirements.exact_text) {
    for (const key of ['zh_json', 'en_json']) assert.ok(result[key].technical.text_requirements.exact_text.includes(literal));
    for (const key of ['zh_simple', 'natural_language_zh']) assert.ok(result[key].includes(JSON.stringify(literal)));
  }
  return result;
}

assert.deepEqual(renderCheck(sample('reusable')), json('examples/reusable.prompts.json'));
const scenarioNames = ['harbor', 'coast', 'greenhouse', 'poster'];
for (const name of scenarioNames) {
  const spec = sample(name);
  assert.deepEqual(spec.core_style_rule_ids, profile.core_rule_ids);
  const output = renderCheck(spec, task(name));
  if (name === 'greenhouse' || name === 'poster') assert.deepEqual(output, json('examples/' + name + '.prompts.json'));
}
for (const core of profile.core_rule_ids) {
  const realizations = new Set(scenarioNames.map(name => sample(name).items.find(item => item.source_rule_ids.includes(core)).text.zh));
  assert.equal(realizations.size, scenarioNames.length, '各题材采用不同实现场景 ' + core);
}
const linkedSpec = sample('case-0002');
const linkedTask = task('case-0002');
assert.deepEqual(renderCheck(linkedSpec, linkedTask), json('examples/case-0002.prompts.json'));
assert.equal(linkedTask.infographic_context.primary_logic, '编年型');
assert.deepEqual(linkedSpec.required_project_lock_ids, ['P01', 'P02', 'P03']);
assert.equal(json('examples/case-0002.review.json').image_status, 'not_generated');
assert.ok(fs.existsSync(path.join(root, manifest.integration_guide)));
assert.ok(fs.existsSync(path.join(root, manifest.linked_example)));
assert.equal(json('examples/greenhouse.review.json').image_status, 'not_generated');
assert.ok(exportPrompts(json('templates/render-spec.template.json')).zh_simple.includes('{{subject}}'));
assert.ok(!renderCheck(sample('greenhouse'), task('greenhouse')).zh_simple.includes('纸粒'));

function rejects(mutator, pattern, name = 'greenhouse') {
  const spec = sample(name);
  const suppliedProfile = json('examples/style-profile.json');
  const suppliedTask = name === 'reusable' ? undefined : task(name);
  mutator(spec, suppliedProfile, suppliedTask);
  assert.throws(() => exportPrompts(spec, suppliedProfile, suppliedTask), pattern);
}

rejects(spec => { spec.items = spec.items.filter(value => value.id !== 'C-S01'); }, /没有映射/);
rejects(spec => { spec.items.find(value => value.id === 'C-S01').priority = 'may'; }, /核心未进入/);
rejects(spec => { spec.active_style_rule_ids = spec.active_style_rule_ids.filter(id => id !== 'S01'); }, /缺少采用记录/);
rejects(spec => { spec.core_style_rule_ids.pop(); }, /清单与风格档案不一致/);
rejects(spec => {
  spec.active_style_rule_ids = spec.active_style_rule_ids.filter(id => id !== 'S01');
  spec.items = spec.items.filter(value => value.id !== 'C-S01');
  spec.rule_exclusions.push({ rule_id: 'S01', reason: '测试排除不满足依赖' });
}, /缺少依赖规则/);
rejects((_, draft) => { draft.rules[0].excludes.push('S02'); }, /存在冲突/);
rejects(spec => { spec.items.find(value => value.id === 'T02').source_lock_ids = []; }, /锁定未进入/);
rejects(spec => { spec.required_project_lock_ids = []; }, /锁定清单与任务不一致/);
rejects(spec => { spec.profile_ref.version = '2.0.0'; }, /风格档案.*不一致/);
rejects(spec => { spec.items[0].text.en = ' '; }, /缺少双语条款/);
rejects(spec => { spec.items[0].text.en = 'Depict an object.'; }, /中英文槽位不一致/, 'reusable');
rejects(spec => { spec.items[0].text.zh = '以 {{ subject }} 为主体。'; }, /无法解析/, 'reusable');
rejects(spec => { spec.items[0].text.zh += '{{unresolved}}'; spec.items[0].text.en += '{{unresolved}}'; },
  /槽位与声明不一致/);
rejects(spec => { spec.text_requirements.exact_text[0] = 'Night Reading'; }, /精确文字与项目任务不一致/, 'poster');
rejects(spec => { spec.output.count = 2; }, /规格与项目任务不一致/);
rejects(spec => { spec.output.dimensions_px.width = 1000; }, /画幅与宽高像素尺寸不一致/);

const rounding = sample('greenhouse');
rounding.output.dimensions_px = { width: 1024, height: 683 };
assert.ok(exportPrompts(rounding, profile).zh_simple.includes('1024 × 683'));
const CLI = spawnSync(process.execPath, [
  path.join(__dirname, 'export-prompts.cjs'), 'examples/greenhouse.render.json', 'examples/style-profile.json', 'examples/greenhouse.task.json'
], { cwd: root, encoding: 'utf8' });
assert.equal(CLI.status, 0, CLI.stderr);
assert.deepEqual(JSON.parse(CLI.stdout), json('examples/greenhouse.prompts.json'));
const failedCLI = spawnSync(process.execPath, [path.join(__dirname, 'export-prompts.cjs'), 'examples/style-profile.json'],
  { cwd: root, encoding: 'utf8' });
assert.equal(failedCLI.status, 1);
assert.equal(failedCLI.stdout, '');
assert.ok(failedCLI.stderr.includes('导出失败'));
console.log('验证通过。完整运行文档、十三项档案、可填槽模板、四个原始主题、CASE-0002 仓库联动和四版导出。');
