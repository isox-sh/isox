# Isox run-many action

Run exactly one matrix row from the Isox plan action. Install the same workspace
dependencies and prepare prerequisite build outputs before invoking it.

```yaml
- uses: isox-sh/isox/actions/run-many@main
  with:
    plan: ${{ toJSON(matrix) }}
    head: ${{ needs.setup.outputs.head }}
```

The worker preserves the planned project list and configuration. It supports
bounded concurrency and ordered pre/post stages, and fails when a task fails.
Stage arrays are passed as JSON, preserving exact command names such as
`prepare,assets`; the installed CLI uses core's shared stage validation.
`head` verifies that the worker checked out the planned commit.

See the [affected and CI guide](../../website/docs/affected-and-ci.md) for complete workflows
and prerequisite/artifact handling. [action.yml](action.yml) lists supported inputs.
