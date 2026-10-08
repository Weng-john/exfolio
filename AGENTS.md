# exfolio Project Agent Rules

## Scope

This file defines rules specific to the `exfolio` research project.

All rules in the global file:

`~/.codex/AGENTS.md`

also apply.

This file may add stricter or project-specific requirements, but it must not weaken the global rules.

## Project identity

This repository belongs to the research project:

`exfolio`

A Research Agent working from this repository must have:

`RESEARCH_PROJECT=exfolio`

The assigned task name is provided through:

`RESEARCH_TASK`

If `RESEARCH_PROJECT` is missing or is not `exfolio`, stop and report the mismatch.

## Human main repository

The Human-maintained main repository is:

`~/sdd_home/agent_workspace/main/exfolio`

It is Human-only.

Research Agents must never modify this repository directly.

All Agent development must occur in a Human-created standalone task clone.

## Task clones

Normal task clones are located under:

`~/sdd_home/agent_workspace/tasks/`

The normal naming convention is:

`exfolio-<task>`

Each development task uses:

`agent/<task>`

as its local branch.

Each task clone must:

- have its own `.git` directory;
- have no Git remote;
- contain this project `AGENTS.md`;
- correspond to the current `RESEARCH_TASK`.

## Project-level formal resources

The following resources belong to the project and are Human-managed:

- `~/sdd_home/agent_workspace/data/raw/exfolio/`
- `~/sdd_home/agent_workspace/data/processed/approved/exfolio/`
- `~/sdd_home/agent_workspace/models/approved/exfolio/`
- `~/sdd_home/agent_workspace/outputs/approved/exfolio/`

Cross-project resources may additionally exist under Human-managed `shared/` namespaces.

Formal project and shared resources are read-only to Research Agents unless the Human explicitly provides a different reviewed sandbox configuration.

Only the Human may promote or reclassify resources into an approved or shared location.

## Task-specific writable resources

For task `<task>`, Agent-writable resources are limited to:

- `~/sdd_home/agent_workspace/data/processed/staging/exfolio/<task>/`
- `~/sdd_home/agent_workspace/data/scratch/exfolio/<task>/`
- `~/sdd_home/agent_workspace/models/staging/exfolio/<task>/`
- `~/sdd_home/agent_workspace/outputs/staging/exfolio/<task>/`
- `~/sdd_home/agent_workspace/logs/agent/exfolio/<task>/`

The launcher provides the canonical writable paths through:

- `RESEARCH_PROCESSED_STAGING`
- `RESEARCH_SCRATCH`
- `RESEARCH_MODELS_STAGING`
- `RESEARCH_OUTPUTS_STAGING`
- `RESEARCH_AGENT_LOGS`

Prefer these environment variables instead of constructing task paths manually.

Do not write into another task's staging, scratch, model, output, or log directories.

## Cross-task resource reuse

A task must not directly depend on another task's staging or scratch files as though they were stable project resources.

If a task produces something that should become reusable:

1. report the artifact and its path;
2. stop treating it as task-private output;
3. wait for Human review;
4. let the Human promote it to an appropriate project-level or shared approved location.

Do not copy or promote it yourself.

## Project specification

Read the project `SPEC.md` before starting substantial work.

Project-specific scientific objectives, datasets, assumptions, baselines, expected outputs, and acceptance criteria should be documented there.

`SPEC.md` and this `AGENTS.md` are Human-maintained and read-only to a Research Agent. The launcher refreshes both from `main/exfolio` before every session, so any copy in the task clone is not yours to edit or commit. If the requested task conflicts with `SPEC.md`, report the conflict instead of silently changing the project definition. Keep method notes, experiment records and design write-ups under the task directory (`exfolio-<task>/`), never in `SPEC.md`.

## Research expectations

When modifying research code:

- preserve reproducibility where practical;
- document important preprocessing assumptions;
- clearly distinguish training, validation, and test data;
- avoid silently changing dataset definitions or evaluation criteria;
- report changes to inputs, labels, targets, thresholds, losses, metrics, or preprocessing;
- report generated model and output paths.

If an experiment changes the prediction target, dataset definition, or evaluation protocol, explicitly mention that in the completion report.

## Reviewer mode

A second Reviewer Agent is optional and exists only when explicitly assigned by the Human.

Global Reviewer rules in `~/.codex/AGENTS.md` apply.

For project `exfolio` and task `<task>`, the review record is:

`~/sdd_home/agent_workspace/logs/reviews/exfolio/<task>/review.md`

Each review round must include:

- reviewed full commit hash;
- tests executed;
- blocking findings;
- required changes;
- non-blocking suggestions;
- data-safety result;
- exactly one verdict: `PASS` or `REJECT`.

A Reviewer `PASS` does not authorize integration into `main`.

## Project completion additions

In addition to the global completion requirements, report project-specific changes involving:

- datasets;
- preprocessing;
- model inputs;
- model architecture;
- prediction targets;
- labels;
- loss functions;
- evaluation metrics;
- trained models;
- generated predictions;
- experimental assumptions.

Then stop and wait for Human review.
