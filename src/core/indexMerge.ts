import type { AllocationTarget, AppData, ID } from './types';

// Treating two underlying indices as one: everything that pointed at the
// merged index is repointed, so its exposure is counted under the other.

export interface IndexMergeSummary {
  instruments: number;
  /** Targets repointed, or folded into an existing target of the kept index. */
  targets: number;
  strategies: number;
  snapshots: number;
  /** Saved Risk Lab scenarios that still mention the merged index by id. */
  scenariosToReview: number;
}

export interface IndexMergeResult {
  data: AppData;
  summary: IndexMergeSummary;
}

/**
 * Merge index `fromId` into `intoId`. Instruments, targets, strategy
 * benchmarks and the per-index history in snapshots move to `intoId`, and
 * the `fromId` index is removed. Returns a new dataset; `data` is untouched.
 *
 * When both indices have a target, their weights add up — the combined
 * exposure is what the user now aims for — and the tighter tolerance wins.
 */
export function mergeIndices(data: AppData, fromId: ID, intoId: ID): IndexMergeResult {
  if (fromId === intoId) throw new Error('不能把指數合併到自己');
  if (!data.indices.some((i) => i.id === fromId)) throw new Error(`找不到指數 ${fromId}`);
  if (!data.indices.some((i) => i.id === intoId)) throw new Error(`找不到指數 ${intoId}`);

  const summary: IndexMergeSummary = {
    instruments: 0,
    targets: 0,
    strategies: 0,
    snapshots: 0,
    scenariosToReview: 0,
  };

  const instruments = data.instruments.map((i) => {
    if (i.indexId !== fromId) return i;
    summary.instruments += 1;
    return { ...i, indexId: intoId };
  });

  const targets: AllocationTarget[] = [];
  for (const target of data.targets) {
    if (target.indexId !== fromId && target.indexId !== intoId) {
      targets.push(target);
      continue;
    }
    if (target.indexId === fromId) summary.targets += 1;
    const kept = targets.find((t) => t.indexId === intoId);
    if (!kept) {
      targets.push({ ...target, indexId: intoId });
      continue;
    }
    kept.targetWeight += target.targetWeight;
    kept.tolerance = Math.min(kept.tolerance, target.tolerance);
    kept.preferredInstrumentId ??= target.preferredInstrumentId;
    if (target.note) kept.note = kept.note ? `${kept.note}；${target.note}` : target.note;
  }

  const strategies = data.strategies.map((s) => {
    if (s.benchmarkIndexId !== fromId) return s;
    summary.strategies += 1;
    return { ...s, benchmarkIndexId: intoId };
  });

  const snapshots = data.snapshots.map((s) => {
    if (!(fromId in s.byIndex)) return s;
    summary.snapshots += 1;
    const byIndex = { ...s.byIndex };
    byIndex[intoId] = (byIndex[intoId] ?? 0) + byIndex[fromId];
    delete byIndex[fromId];
    return { ...s, byIndex };
  });

  // Scenario parameters belong to the simulation that saved them, so they
  // are not rewritten here: the user is told how many to look at.
  summary.scenariosToReview = data.scenarios.filter((s) =>
    JSON.stringify(s.params).includes(JSON.stringify(fromId)),
  ).length;

  return {
    data: {
      ...data,
      indices: data.indices.filter((i) => i.id !== fromId),
      instruments,
      targets,
      strategies,
      snapshots,
    },
    summary,
  };
}
