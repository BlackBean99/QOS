import { StrategyManagementService } from "./strategy-management";
import { getBacktestHistoryRepository, getStrategyRepository } from "./strategy-repository";
import { executeStoredBacktest } from "./stored-backtest-runner";

let defaultService: StrategyManagementService | null = null;

export function getStrategyManagementService(): StrategyManagementService {
  defaultService ??= new StrategyManagementService({
    strategies: getStrategyRepository(),
    history: getBacktestHistoryRepository(),
    execute: executeStoredBacktest,
  });
  return defaultService;
}
