# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, review the confirmed visual direction below and the reference image at `../../design/selected-blueprint-reference-v2.png`. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in this file.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Confirmed visual direction

- Source: `../../design/selected-blueprint-reference-v2.png` (the user-confirmed colorful blueprint mock).
- Preserve the technical hand-drawn blueprint composition and dense desktop workflow editor.
- Use richer but restrained colors: blue, amber, mint, coral, and violet per workflow step.
- Keep the bottom execution log and response workspace pure white.
- Product language is Simplified Chinese.
- MVP controls must be functional, keyboard accessible, and responsive.

## Product direction (2026-09-12)

- Primary users are testing and development teams turning APIs and business flows into trustworthy automated regression.
- Organize the main journey around business intent, draft review, versioned execution, and failure evidence.
- Preserve the confirmed blueprint visual language while improving task entry and truthful states.

## AI test plan direction (2026-09-28)

- User selected option 3: conversation on the left, editable structured plan on the right.
- Visual source: `../../docs/design/evidence/2026-09-28/ai-plan-selected-option-3.png`.
- Keep the existing shell, graph-paper asset and warm brown brand; mint identifies published/AI state and amber identifies pending gaps.
- Use real model jobs and source versions. Keep unpublished drafts separate from executable members. Saving, publishing and execution are separate actions.
- Long real conversations and asset names must scroll without hiding the composer or save controls. Preserve manual plan management through the published-plans entry.

## Capability map direction (2026-09-28)

- First version: capability map, live workspace state, and links to existing product actions.
- Keep trigger conditions separate from who does the work; AI and rule output requires explicit review and publication.
- Never infer execution readiness from configured assets. Unreadable state is unknown; schedule configuration does not prove active timed dispatch.
- Present three explicit responsibility blocks: system automation (mint), AI assistance (violet), and manual actions (amber). Separate rule-generated drafts, AI-generated drafts, and human review into their own entries; put these blocks before secondary workflow/status content.
- Capability-map copy should feel literary and warm in headings and introductions; keep category names, action labels, live statuses and capability boundaries explicit and precise.
