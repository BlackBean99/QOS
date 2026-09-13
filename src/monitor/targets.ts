import {
  StoredStrategySchema,
  type InstrumentSnapshot,
  type StoredStrategy,
} from "@/src/domain/stored-strategy";

export function effectiveMonitorTargets(document: StoredStrategy): InstrumentSnapshot[] {
  const targets = document.monitor.targets;
  const values = targets && targets.length > 0 ? targets : [document.instrument];
  const controls = new Map(
    document.monitor.targetControls?.map((control) => [control.instrumentId, control]) ?? [],
  );
  return structuredClone(
    values.filter((target) => controls.get(target.instrumentId)?.enabled !== false),
  );
}

export function expandMonitorTargets(document: StoredStrategy): StoredStrategy[] {
  const controls = new Map(
    document.monitor.targetControls?.map((control) => [control.instrumentId, control]) ?? [],
  );
  return effectiveMonitorTargets(document).map((target) => {
    const control = controls.get(target.instrumentId);
    return StoredStrategySchema.parse({
      ...document,
      instrument: target,
      strategy: {
        ...document.strategy,
        market: target.market,
        instrumentId: target.instrumentId,
      },
      monitor: {
        ...document.monitor,
        targets: [target],
        ...(control ? { targetControls: [control] } : { targetControls: undefined }),
      },
    });
  });
}

export function monitorHedgeInstrument(document: StoredStrategy): InstrumentSnapshot | undefined {
  return document.monitor.targetControls?.find(
    (control) => control.instrumentId === document.instrument.instrumentId,
  )?.hedgeInstrument;
}

export function monitorEvaluationKey(document: StoredStrategy): string {
  return `${document.id}:${document.revision}:${document.instrument.instrumentId}`;
}

export function monitorDeliveryKey(
  document: StoredStrategy,
  side: "BUY" | "SELL",
  barTimestamp: string,
): string {
  return `${monitorEvaluationKey(document)}:${side}:${barTimestamp}`;
}

export function monitorPositionKey(document: StoredStrategy): string {
  return `${document.id}:${document.instrument.instrumentId}`;
}
