import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { discoverSpringApi } from '../index.js';

const repositoryUrl = 'https://github.com/example/service';
const controller = (content: string) => ({
  path: 'src/main/java/demo/controller/StaffController.java',
  content,
});
const analyze = (content: string) =>
  discoverSpringApi({
    repositoryUrl,
    commit: 'a'.repeat(40),
    files: [
      controller(content),
      {
        path: 'src/main/java/demo/dto/StaffRequest.java',
        content:
          'public class StaffRequest { @NotBlank private String name; @NotNull private Long teamId; private String notes; }',
      },
    ],
  });

describe('Spring source evidence', () => {
  test('binds literal prefixes, query/path parameters, DTO constraints and explicit statuses to code lines', () => {
    const model = analyze(`@RestController
@RequestMapping("/api/staff")
public class StaffController {
 @GetMapping("/{id}") public ResponseEntity<Staff> get(@PathVariable Long id, @RequestParam(required=false) String keyword) { return ResponseEntity.ok(service.get(id)); }
 @PostMapping public ResponseEntity<Staff> create(@Valid @RequestBody StaffRequest body) { return ResponseEntity.status(201).body(service.create(body)); }
 @DeleteMapping("/{id}") public ResponseEntity<Void> delete(@PathVariable Long id) { service.delete(id); return ResponseEntity.noContent().build(); }
}`);
    expect(
      model.endpoints.map((e) => [e.method, e.path, e.responses.map((r) => r.statusCode)]),
    ).toEqual([
      ['GET', '/api/staff/{id}', [200]],
      ['POST', '/api/staff', [201]],
      ['DELETE', '/api/staff/{id}', [204]],
    ]);
    expect(model.endpoints[0]?.parameters.map((p) => [p.name, p.in, p.required])).toEqual([
      ['id', 'path', true],
      ['keyword', 'query', false],
    ]);
    expect(model.endpoints[0]?.sourceLocations[0]?.location).toContain('#L4');
    expect(model.schemas['/schemas/StaffRequest'].required).toEqual(['name', 'teamId']);
    expect(model.schemas['/schemas/StaffRequest/properties/name'].minLength).toBe(1);
    expect(model.endpoints[1]?.requestBodies[0]?.content['application/json']?.schema.ref).toBe(
      '/schemas/StaffRequest',
    );
  });
  test('does not scan comments, quoted annotations, or test-like route text in a method body', () => {
    const model = analyze(`// @RestController @RequestMapping("/fake")
@RestController
public class StaffController {
 /* @GetMapping("/comment") public Object fake() { return ResponseEntity.ok(1); } */
 @GetMapping("/real") public Object get() { String text="@GetMapping(\\"/string\\")"; return ResponseEntity.ok("}"); }
}`);
    expect(model.endpoints.map((e) => e.path)).toEqual(['/real']);
  });
  test.each(['BASE', 'path=BASE', 'path="/api" + BASE', '"${api.prefix}"'])(
    'rejects dynamic class mapping %s',
    (mapping) => {
      expect(
        analyze(
          `@RestController @RequestMapping(${mapping}) public class StaffController { @GetMapping public Object get() { return ResponseEntity.ok(1); } }`,
        ).endpoints,
      ).toHaveLength(0);
    },
  );
  test('unknown return behavior remains visible without an invented success status', () => {
    const model = analyze(
      '@RestController public class StaffController { @GetMapping("/a") public Object get() { return service.get(); } }',
    );
    expect(model.endpoints[0]?.responses).toEqual([]);
    expect(model.diagnostics.some((d) => d.message.includes('HTTP 状态'))).toBe(true);
  });
  test('cross products literal route arrays and method lists without silently dropping conditional mappings', () => {
    const model = analyze(
      '@RestController @RequestMapping({"/a","/b"}) public class StaffController { @RequestMapping(path="/c",method={RequestMethod.GET,RequestMethod.POST}) public Object get() { return ResponseEntity.ok(1); } @GetMapping(path="/d",params="v=2") public Object conditional() { return ResponseEntity.ok(1); } }',
    );
    expect(model.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
      'GET /a/c',
      'GET /b/c',
      'POST /a/c',
      'POST /b/c',
    ]);
    expect(model.diagnostics.some((d) => d.message.includes('带条件'))).toBe(true);
  });
  test('never persists raw code, literals or credentials from method bodies', () => {
    const model = analyze(
      '@RestController public class StaffController { @GetMapping("/health") public Object get() { String token="sk-test-private-value"; return ResponseEntity.ok(token); } }',
    );
    expect(JSON.stringify(model)).not.toContain('sk-test-private-value');
    expect(model.metadata.extra?.['commit']).toBe('a'.repeat(40));
  });
});

test('source manifest hash is stable across reimports and matches the archived manifest bytes', () => {
  const input = {
    repositoryUrl,
    commit: 'a'.repeat(40),
    files: [
      controller(
        '@RestController public class StaffController { @GetMapping("/health") public Object get() { return ResponseEntity.ok(1); } }',
      ),
    ],
  };
  const first = discoverSpringApi({ ...input, ingestedAt: '2026-09-23T00:00:00Z' });
  const second = discoverSpringApi({ ...input, ingestedAt: '2026-09-23T01:00:00Z' });
  expect(first.metadata.sourceHash).toBe(second.metadata.sourceHash);
  expect(
    createHash('sha256')
      .update(
        JSON.stringify({
          repositoryUrl,
          commit: input.commit,
          files: first.metadata.extra?.['files'],
        }),
      )
      .digest('hex'),
  ).toBe(first.metadata.sourceHash);
});
