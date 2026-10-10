> 历史记录：2026 年 6–7 月原型阶段的设计、计划或审视；不作为当前实现说明或待执行指令。当前入口见 [仓库 README](../../../README.md)。

# Design QA — 导入中心

## Comparison target

- Source visual truth: `/Users/zhinan/.codex/generated_images/019f6902-266e-7f82-b396-26b3bd4b9d7e/exec-2e4d9893-b2ec-4a29-a2fd-cf8bdf98ae48.png`
- Browser-rendered implementation: `http://127.0.0.1:5174/import`
- Implementation screenshot: `/tmp/sketchtest-import-implementation.png`
- Viewport: 1440 × 1024 desktop
- State: default source-selection view, first import task expanded and set to the recommended conflict strategy.

## Evidence

Full-view comparison was performed with the source visual and browser screenshot in the same review input. Both show the same hierarchy: source-selection panel with file and URL entry paths, followed by a batch-style import queue and an expanded preflight review task.

A focused region comparison was not needed: the source-selection area and expanded task are both large enough to inspect in the full-view pair. The implementation uses the existing product shell rather than reproducing the concept's static header controls; this is an intentional integration constraint, not a task-flow mismatch.

## Findings

No actionable P0, P1, or P2 findings remain.

- P3 — Product-shell header differs from the concept header.
  - Evidence: the implementation retains the existing `CONTROL PLANE` header and global actions; the concept labels the header `IMPORT CENTER` and includes import history.
  - Classification: acceptable integration difference. Retaining shared navigation avoids changing unrelated routes; the route title, source selection, queue structure, and primary import decision flow match the selected concept.

## Fidelity surfaces

- Fonts and typography: the existing product's sans-serif system and compact uppercase metadata preserve the concept's scan hierarchy. Headings, counts, queue status, and decision labels remain legible with no wrapping or truncation at the reviewed viewport.
- Spacing and layout rhythm: the two-column source panel, queue spacing, expanded preflight card, and decision column follow the visual target's spatial order and remain above-the-fold without collisions.
- Colors and visual tokens: warm off-white grid background, restrained green success, amber warning, and rust primary action map to the selected concept while preserving existing control-plane tokens.
- Image quality and asset fidelity: no images or illustrations are required by the selected concept. The product logo is the existing logo, and all UI icons use the project's icon library rather than custom-drawn substitutes.
- Copy and content: file, URL, preflight, conflict-strategy, and irreversible-write safety language are specific to the import flow and distinguish it from API asset management.
- Interactions and accessibility: semantic buttons, labelled radios, file input, URL entry, expanded task disclosure, and live status feedback are present. Tested URL entry expansion and conflict strategy selection; browser console contained no errors.

## Comparison history

1. Initial implementation review: the source-selection controls were too evenly weighted and the page heading competed with the concept's compact source-entry layout.
   - Fix: made the file upload action the wide, dashed primary panel; placed URL import as its adjacent secondary action; removed the redundant in-content page heading.
   - Post-fix evidence: `/tmp/sketchtest-import-implementation.png` captured at 1440 × 1024 and compared with the source visual in one review input.

## Implementation checklist

1. Keep the selected source method controls functional.
2. Keep preflight results visible before the confirm-import action.
3. Preserve the browser-console check when adding new import source types.

final result: passed

---

# Design QA — 用例管理：风险列表与处置详情

## Comparison target

- Source visual truth: `/Users/zhinan/.codex/generated_images/019f82d0-22fc-7a82-aace-f623ca52d88e/exec-20363f79-6687-496c-8561-02743f6ced70.png`
- Browser-rendered implementation: `http://127.0.0.1:5177/cases`
- Implementation screenshot: `/tmp/sketchtest-cases-implementation.png`
- Full-view comparison evidence: `/tmp/sketchtest-cases-comparison.png`
- Viewport: 1440 × 1024 desktop.
- State: `需要处理` selected; `支付订单 · 金额边界` selected; API type-change evidence visible.

## Findings

No actionable P0, P1, or P2 findings remain.

- P3 — Global action labels retain the established application shell.
  - Evidence: the selected source uses a top-bar creation action; the implementation retains existing Import / Environment / Save / Run controls and places the contextual repair action in the detail header.
  - Classification: acceptable integration difference. The contextual repair action is closer to the selected task and avoids changing unrelated global navigation.

## Fidelity surfaces

- Fonts and typography: the existing serif display heading, compact monospace endpoint/version metadata, and warm small-label hierarchy reproduce the selected concept without observed wrapping or clipping at 1440px.
- Spacing and layout rhythm: the list and detail panels begin directly below the product top bar, matching the source’s split-workbench hierarchy. The detail header, evidence blocks, and task row spacing preserve the target’s reading order.
- Colors and visual tokens: warm paper, graph texture, tobacco-brown primary action, restrained red impact labels, green recommended change, and pale comparison surfaces map directly to the selected visual language.
- Image quality and asset fidelity: the selected concept is UI-only. Existing SketchTest branding and the established Phosphor icon library are retained; no custom raster or hand-drawn asset is needed.
- Copy and content: list rows communicate trigger, evidence, critical flow, and priority; the detail states source version, contract difference, required change, and Run evidence. Draft selection switches to generation evidence, review focus, and validation gating.
- Interactions and accessibility: verified list selection, trigger filtering, selected-detail replacement, draft-specific validation guardrails, repair/review toast feedback, labelled search/filter controls, and tab semantics. A fresh browser tab had no console warnings or errors.

## Comparison history

1. Initial implementation placed the queue tabs in a full-width toolbar, pushing the selected detail below the source visual’s above-the-fold position.
   - Fix: moved the tabs inside the left queue so the detail starts immediately beneath the shared product top bar.
   - Post-fix evidence: `/tmp/sketchtest-cases-comparison.png` shows matching list/detail panel proportions and detail-header placement.
2. Initial generated-draft selection reused contract-change wording and failed to explain its review gate.
   - Fix: render generation evidence, review comparison, and validation-before-CI checklist for draft tasks.
   - Post-fix evidence: browser DOM capture after selecting `生成草稿` showed the draft-specific detail state and validation gate.

## Implementation checklist

1. Replace local risk-task fixtures with Control Plane projections for change impact, latest Run evidence, TestCaseVersion, workflow, and suite references.
2. Connect `创建修复草稿` to a version-derived draft creation API before making the UI action durable.
3. Preserve the current draft-first gate: a draft must be validated and published before test-suite or CI inclusion.

final result: passed

---

# Design QA — 报告中心与业务场景报告

## Comparison target

- List source visual truth: `/Users/zhinan/.codex/generated_images/019f8276-a186-75c0-a88d-50f6d735ca41/exec-9a0ababf-08d2-492e-9ca9-962f73b87270.png`
- Detail source visual truth: `/Users/zhinan/.codex/generated_images/019f8276-a186-75c0-a88d-50f6d735ca41/exec-e348149c-c15e-4bad-a76c-53e39bb242fb.png`
- Browser-rendered list: `http://127.0.0.1:5174/reports`
- Browser-rendered detail: `http://127.0.0.1:5174/reports/run-001/wf-bp07`
- Implementation screenshots: `/tmp/sketchtest-report-list-implementation.png`, `/tmp/sketchtest-report-detail-implementation.png`
- Full-view comparison evidence: `/tmp/sketchtest-report-list-comparison.png`, `/tmp/sketchtest-report-detail-comparison.png`
- Viewport: 1440 × 1024 desktop.
- State: list default and `断言未通过` filter; detail for `BP-07 异常路径：认证失败处理`, response evidence tab and expanded Agent advice verified.

## Findings

No actionable P0, P1, or P2 findings remain.

- P3 — The implementation retains the established SketchTest top bar and white navigation instead of reproducing the generated concepts' dark-green standalone shell.
  - Evidence: both comparison images show the report-specific hierarchy matches, while navigation is inherited from the working product layout.
  - Classification: acceptable integration difference. Altering global navigation for these two routes would create unrelated product drift.

## Fidelity surfaces

- Fonts and typography: display headings, compact mono version metadata, assertion labels and dense table copy preserve the reference's factual scan order; no inspected labels truncate at 1440px.
- Spacing and layout rhythm: the list keeps summary → filters → rows as one continuous scan; the detail keeps conclusion → StepRun → evidence alongside the traceability rail.
- Colors and visual tokens: warm paper/grid background, restrained green execution-success, brick assertion failure and amber unassessed states are semantic and distinct.
- Image quality and asset fidelity: the references are UI-only and require no custom raster assets. Existing product branding and the Phosphor icon library are retained.
- Copy and content: the implementation uses real domain labels (`RunSnapshot`, `WorkflowVersion`, `StepRun`, `Trace ID`) and separates `断言未通过` from `执行异常`.
- Interactions and accessibility: tested list filtering, a scoped report navigation, evidence tab switching, Agent advice expansion, and the redacted curl copy confirmation. Browser console contained no errors during the final detail check.

## Comparison history

1. Initial detail navigation retained the list scroll position, hiding the report title and conclusion on first open.
   - Fix: reset `document.scrollingElement.scrollTop` when the detail report changes.
   - Post-fix evidence: `/tmp/sketchtest-report-detail-implementation.png` shows the back link, business scenario title and factual assertion result at the top of the viewport.
2. Initial factual failure copy exposed only a prose sentence.
   - Fix: render explicit `期望（Expected）` and `实际（Actual）` values whenever the assertion supplies them.
   - Post-fix evidence: `/tmp/sketchtest-report-detail-comparison.png` shows the separated 401/200 comparison cells beneath `断言未通过`.

## Implementation checklist

1. Keep assertion outcome and execution health as separate fields in the Control Plane report projection.
2. Attach actual immutable input-version IDs and evidence-manifest hashes when the mock data is replaced by report APIs.
3. Keep Agent advice evidence-cited, collapsed by default and unable to mutate the execution conclusion.

final result: passed

---

# Design QA — 变量接口取值

## Comparison target

- Source visual truth: `/Users/zhinan/.codex/generated_images/019f6a8d-0ff1-7632-ae50-4555553c22ac/exec-bc03e3d2-4417-495f-b970-48ceea867e69.png`
- Browser-rendered implementation: `http://127.0.0.1:5174/variables`
- Implementation screenshot: `./variable-source-drawer-1440.png`
- Viewport: 1440 × 1024 desktop
- State: `accessToken` has an API source selected; Host is resolved and the `运行前刷新` draft policy is visible.

## Evidence

The source visual and browser-rendered implementation were opened together for the same review input at 1440 × 1024. The focused drawer region was reviewed alongside the table row that invokes it. The save action, endpoint selector, Host selector, refresh-policy selector, close action, and console error check were exercised; the browser console had no errors or warnings.

## Findings

No actionable P0, P1, or P2 findings remain.

- P3 — The product shell and table metadata differ from the concept board.
  - Evidence: the implementation keeps SketchTest's existing navigation, active environment and source/system columns, while the concept uses a smaller standalone variables shell.
  - Classification: intentional integration difference. Keeping the existing product shell preserves navigation and the established environment-variable model.

## Fidelity surfaces

- Fonts and typography: compact mono metadata, Chinese labels and 1–3 step markers preserve the target's technical hierarchy; controls remain readable without truncation at the reviewed viewport.
- Spacing and layout rhythm: the right drawer occupies the same dominant side-panel role; source request, extraction and policy sections are separated by thin rules with consistent vertical cadence.
- Colors and visual tokens: the existing warm paper, pale-blue grid, rust primary action, green scope tags and restrained warning colors match the target direction.
- Image quality and asset fidelity: this is a UI-only feature. The existing product logo and Phosphor icon library are retained; no custom raster/illustration asset is required by the selected concept.
- Copy and content: interface, Host variable, JSONPath, Runner and Secret copy explain the real execution model rather than presenting a generic key-value editor.

## Comparison history

1. Initial browser review at the default desktop width found the new source column made the first table column crop.
   - Fix: reduced the variable-table grid tracks and added a deliberate compact breakpoint.
   - Post-fix evidence: `./variable-source-drawer-1440.png`, re-captured and compared at 1440 × 1024.

## Implementation checklist

1. Keep manual source tests routed through the Runner with explicit extraction metadata.
2. Keep sensitive source values redacted in the drawer and run output.
3. Compile `运行前刷新` into workflow execution before presenting it as an active published policy.

final result: passed
