# Design QA · Agent 配置与用例溯源

final result: passed

## 2026-10-10 · Selected pixel robot revision

User-selected visual: `references/pixel-agent-selected.png` (exact attached design). This revision supersedes the earlier management reference below. Business layouts retain their approved structure with the new identity avatar applied.

- Final visual comparison: `evidence/pixel-comparison.jpg`, reference and implementation side by side at equivalent 1440 × 1024 size. Inspected together; no unresolved P0/P1/P2 findings.
- Actual management screenshot: `evidence/pixel-agent-management.jpg`. Warm master/detail, three colored pixel robot identities, monospace Agent path, enabled toggle, configuration and model selectors retained.
- Assets: generated transparent raster sprites in `public/avatars/`; all three loaded successfully. Identity is a stored Agent property and is copied into each execution snapshot, independent of provider/model choice.
- Business evidence: `evidence/pixel-generation.jpg`, `evidence/pixel-case.jpg`, `evidence/pixel-trace.jpg`. Avatar appears in generation selection/runtime, recent executions, testcase provenance, execution snapshot and read-only config.
- Mobile evidence: `evidence/pixel-mobile.jpg`, `evidence/pixel-mobile-trace.jpg`. At 390 × 844, document and drawer widths are 390px. Roster scrolls inside its container; configuration stacks without page overflow.
- Fixed during QA: initial desktop save action extended below the viewport; aligned header height and textarea size to reference. Final save button bottom is 996.5px at a 1024px viewport and scrollY=0.
- Browser checks: changed language Agent from 智谱 to OpenAI and saved v3; green identity remained. Selected it for simulated generation; both selection and runtime showed `/avatars/language.png`, v3 and gpt-5.6, producing six pending drafts. Existing testcase still traced to contract Agent v3 / OpenAI / gpt-5.6. Opened execution record and immutable configuration; verified mobile drawer/navigation.
- Build passed. Final preview console contains no warnings/errors. This remains an in-memory prototype with simulated providers.
- P3: body metadata is slightly more compact than the generated reference; disabled save reflects unchanged form state. No blocking fidelity issues.

## Previous revision: comparison target and evidence

Source visual truth (selected unified solution):
- `references/agent-management.png`
- `references/case-detail.png`
- `references/execution-drawer.png`

All source images: 1487 × 1058 pixels. Normalized to 1440 × 1024 for comparison (same aspect ratio within rounding). Browser: Codex in-app browser. Desktop CSS viewport: 1440 × 1024, devicePixelRatio 1; implementation screenshots 1440 × 1024. Mobile CSS viewport: 390 × 844, density 1.

Rendered stable preview: http://127.0.0.1:4318/

Final browser evidence:
- `evidence/agent-management-final.jpg` — initial contract Agent v3 selected, editable configuration.
- `evidence/case-detail-final.jpg` — published testcase v2 with original generation and human edit lineage.
- `evidence/execution-drawer-final.jpg` — same case, generation record gen_1042 open, model call expanded.
- `evidence/mobile-agents-final.jpg`, `evidence/mobile-case.jpg`, `evidence/mobile-trace.jpg`.

Combined full-view comparisons (reference left, implementation right):
- `evidence/compare-agent-management-final.jpg`
- `evidence/compare-case-detail-final.jpg`
- `evidence/compare-execution-drawer-final.jpg`

Focused identity comparison: `evidence/focused-execution-identity.jpg`. This checks legibility and exact provider/model/version attribution at native pixel scale; both sources are in the same comparison image. Screenshots were captured after confirming the corresponding rendered state; stale compositor captures were replaced and excluded from the final comparison.

## Findings and iteration history

1. Initial comparison: blocked.
   - P2: Agent form action footer was below the desktop viewport. Source kept save action visible. Reduced form section/header spacing; matched source list/detail split to 37%/63%.
   - P2: Case source link and execution snapshot link drifted below the fold. Reduced case section spacing; kept the drawer snapshot action available at its footer.
   - P2: Initial 390px management layout overflowed horizontally to 699px. Used zero-minimum grid tracks and min-width:0, contained Agent list scrolling, and hid closed mobile navigation from accessibility/layout interaction.
2. Final comparison: passed.
   - Agent save button bottom: 981.9px at 1024px viewport.
   - Case source link bottom: 952.1px; lineage panel bottom: 1012.7px.
   - Mobile document scrollWidth equals viewport width (390px); drawer width 390px and internal scrollWidth 389px.
   - Final full-view and focused comparisons show no remaining P0/P1/P2 issue. Long content and expanded optional sections scroll normally.

## Required fidelity surfaces

- Typography: existing project Caveat brand, Noto Serif SC headings, Inter/Noto Sans SC body, monospace identifiers. Hierarchy and wrapping preserved. Metadata is somewhat more compact than the generated mock; minor P3 optical polish remains.
- Spacing/layout: independent Agent settings, business detail with supporting provenance, contextual right drawer. Primary actions fit desktop; mobile stacks sections and uses off-canvas navigation. Drawer remains in the business context.
- Color/tokens: warm paper, brown primary, subtle rules, green completed and amber draft states. Existing graph-paper asset is reused; it is slightly cooler than the generated case mock, an intentional existing-product alignment.
- Assets: existing graph-paper raster, existing project brand treatment, Phosphor icon library. No generated decorative assets or rasterized functional UI. No custom drawn icons.
- Copy/content: separates Agent configuration from execution snapshots; explicitly labels example data; generation remains pending review; human changes are recorded separately; actual model is visible; unavailable provider snapshot is stated. Test HTTP execution and AI generation records remain separate.

## Functional checks performed in browser

- Create a named 智谱 Agent, verify it appears in the generation selector with its version and model.
- Change an existing Agent from OpenAI to 智谱, save v4, inspect version list; old testcase still opens v3 / OpenAI / gpt-5.6. Read-only snapshot explicitly states current configuration is v4 while historical execution uses v3.
- Add a DeepSeek example connection using a non-secret reference; verify connection table.
- Start simulated generation with the new Agent; selector disabled while running; stage progression; completion produces six pending drafts.
- Accept a pending draft into an unpublished testcase; edit request quantity from 1 to 2; publish separately; original output still contains quantity 1 and retains the selected Agent/model.
- Inspect execution process, input/evidence, original output, and immutable Agent snapshot.
- Verify desktop and mobile navigation, drawer close/return, accessible dialog title, no horizontal overflow.
- Build completed successfully. Production preview console checked: no errors or warnings from port 4318. An early dev-only duplicate React hook error was fixed with Vite React deduplication before stable-preview verification.

## Open questions and intentional limits

- No unresolved question blocks the agreed prototype. True provider calls, persistent version records, authorization, production failure/retry events, and Runner execution remain product implementation work.
- Model IDs, tokens, timings and payloads are illustrative; the prototype makes this visible.
- Other product navigation entries are intentionally disabled outside this scoped flow.
- State resets on reload; this is documented, not production persistence.

## Implementation checklist

- [x] Independent Agent management.
- [x] Explicit Agent selection and frozen generation identity.
- [x] Draft review and separate publication.
- [x] Business-embedded provenance and execution drawer.
- [x] Human changes preserve original AI output.
- [x] Desktop and narrow-screen visual/interaction QA.

## Follow-up polish

P3: refine metadata typography and code syntax styling toward the mock if the design is integrated into the production component system.
