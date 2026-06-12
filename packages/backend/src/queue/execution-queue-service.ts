import type {
  ExecutionQueueStore,
  EnqueueExecutionJobInput,
  ExecutionQueueListFilter,
} from "./execution-queue-store.js";

export interface ExecutionQueueService {
  enqueue(
    input: EnqueueExecutionJobInput,
  ): ReturnType<ExecutionQueueStore["enqueue"]>;
  list(
    filter?: ExecutionQueueListFilter,
  ): ReturnType<ExecutionQueueStore["list"]>;
  get(jobId: string): ReturnType<ExecutionQueueStore["get"]>;
  claimNext(workerId: string): ReturnType<ExecutionQueueStore["claimNext"]>;
}

export function createExecutionQueueService(
  store: ExecutionQueueStore,
): ExecutionQueueService {
  return {
    enqueue(input) {
      return store.enqueue(input);
    },
    list(filter) {
      return store.list(filter);
    },
    get(jobId) {
      return store.get(jobId);
    },
    claimNext(workerId) {
      return store.claimNext(workerId);
    },
  };
}
