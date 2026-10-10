# Generation Protocol v1

Versioned boundary for an independent AI Worker. Zod inputs and outputs contain
no Pi-specific event/message objects. Runner Protocol adds only an optional
`environmentVersionId` for execution provenance; old plan fixtures remain compatible.

- `GenerationTask` is a bounded, curated API evidence projection.
- `GeneratedDraft` can only be pending and must contain at least one assertion.
- `GenerationResult` includes source and input hashes plus harness/model/prompt identity.
- Keep source authorization, source custody, and secret removal on the caller side.
- Schema changes require consumer updates and intentional golden snapshot review.
- Runtime safety checks in the worker additionally bind URL/method/risk and require
  a documented response-status assertion. Schemas alone do not prove semantics.

- `WorkerIdentity` and `GenerationLease` describe claim identity, frozen model target and fencing token.
- `generationRequestUrl` maps source path parameters to explicit environment inputs.
- Both Worker and CP use `validateGenerationResult`; persistence must never trust Worker output without this second validation.

## Plan protocol

`plan.ts` adds `sketch-test.plan-generation/v1`, `PlanAsset`, `PlanProposal`,
`PlanTask`, `PlanResult`, and `PlanLease`. `validatePlanProposal` rejects unknown
or duplicate members and prevents pending drafts from becoming executable
members. Gaps-only proposals may be saved but CP must reject their publication.
`validatePlanResult` binds workspace/job, source/input hash, and model target.
`WorkerIdentity.capabilities` is optional for backwards-compatible discovery.
