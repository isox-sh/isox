# Isox run-many action

Run exactly one matrix row from the Isox plan action. Install the same workspace
dependencies, including `@isox-sh/cli`. Targets with `dependsOn` expand prerequisites
in the worker; prepare any other required build outputs before invoking it.

```yaml
- uses: isox-sh/isox/actions/run-many@main
  with:
    plan: ${{ toJSON(matrix) }}
    head: ${{ needs.setup.outputs.head }}
```

The worker preserves the planned project list and configuration. It supports
bounded concurrency and ordered pre/post stages, and fails when a task fails.
Declared prerequisites may add tasks outside the planned project list. Each worker
runs and deduplicates its own task graphs; separate jobs do not share scheduling.
Stage arrays are passed as JSON, preserving exact command names such as
`prepare,assets`; the installed CLI uses core's shared stage validation.
`head` verifies that the worker checked out the planned commit.

Each `run-many` invocation refreshes `.isox/workspace.json`; its child commands
then load those project definitions. Selection does not analyze dependencies.
An executor can request analysis and validate `.isox/discovery.json` separately.
Neither cache skips tasks or restores prerequisite build outputs.

See the [affected and CI guide](../../website/docs/affected-and-ci.md) for complete workflows
and prerequisite/artifact handling. [action.yml](action.yml) lists supported inputs.
