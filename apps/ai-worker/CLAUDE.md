# @sketch-test/ai-worker

Independent Node.js process using Pi 1.1.0. The daemon authenticates to a workspace-bound CP queue, renews fenced leases,
and supervises one child process per task. A bounded stdin task becomes a
validated GenerationResult; CP commits pending drafts transactionally.

- Import other product code only through versioned contract packages.
- Test tasks expose only `read_endpoint` and `propose_test`; plan tasks expose only
  `propose_plan`. No shell, filesystem,
  arbitrary HTTP, secret resolution, execution, or publication tools.
- Each task gets its own Agent. Never reuse sessions across workspaces.
- The caller supplies a curated, secret-free API projection and authenticates its
  source hash. The worker computes an input hash; it does not prove source custody.
- Keep all generated output pending human review. Semantic correctness is not
  proved by structural validation or by a model's rationale.
- Model/provider selection is explicit. Never substitute a model silently.
- Do not persist raw reasoning, credentials, prompts, or provider error bodies.
- Test with the actual Pi Agent loop and an injected deterministic provider stream.
  No model credentials are needed for the test suite.

See `README.md` for execution and `../../docs/adr/0002-pi-generation-harness.md`
for the integration boundary, operating limits and acceptance evidence.

## Plan generation

The daemon advertises `plan` capability and polls a separate plan queue alongside
test generation. `plan-harness.ts` consumes `PlanTask` and returns `PlanResult`;
each task still runs in its own supervised child. Plans select from the supplied
immutable asset snapshot. Pending drafts can appear only as gaps. The latest
user objective overrides previous membership; do not keep unrelated workflows
merely because a previous proposal included them. CP validates output again,
saves an editable suggestion, and owns the explicit publication transaction.
