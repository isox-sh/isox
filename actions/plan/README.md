# Isox plan action

Select affected projects and distribute their exact names into weighted matrix
shards. Install the workspace's Isox CLI first and check out full Git history.

```yaml
- uses: isox-sh/isox/actions/plan@main
  id: plan
  with:
    targets: test
    targetOptions: '{"test":{"maxJobs":3,"parallel":2}}'
```

Use the `matrix` output as `strategy.matrix` and gate the worker job with
`hasPlan == 'true'`. Projects can declare `plan.weight` (default `1`).
Set `plan.enabled: false` in `project.json` to exclude a project from planning;
changes to it still affect its dependents. `plan.enabled` defaults to `true`.

Pull requests use their base SHA. Other events use the nearest reachable Git tag,
including lightweight tags, and select all projects when no tag is reachable.
An explicit `base` overrides this selection. Use checkout's `fetch-depth: 0` to
fetch complete history and tags.

Planning refreshes project definitions on every invocation. Affected selection
also validates and reuses dependency analysis from `.isox/discovery.json`;
selecting all projects does not require that analysis. These are metadata caches,
not caches of task results or build artifacts.

See the [affected and CI guide](../../website/docs/affected-and-ci.md) for inputs,
Git ranges, tag filters, weighted distribution, migration, and complete workflows.
The action metadata in [action.yml](action.yml) lists every supported input/output.
