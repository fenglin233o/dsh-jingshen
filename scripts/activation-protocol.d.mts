import type { ActivationDetails, ActivationPaths, ActivationReceipt, ActivationStatus, SupervisorState } from '../src/activation.ts'
export const UUID: RegExp
export const stamp: () => string
export function checkedDirectory(path: string, create?: boolean): string
export function activationPaths(stateDir: string): ActivationPaths
export function readJSON<T = any>(path: string, optional?: boolean): T | undefined
export function writeJSON(path: string, value: unknown, exclusive?: boolean): void
export function recordPath(directory: string, id: string): string
export function listReceipts(paths: ActivationPaths): ActivationReceipt[]
export function receiptState(paths: ActivationPaths, receipt: ActivationReceipt, status: ActivationStatus, detail: string,
  extra?: Partial<ActivationReceipt>): ActivationReceipt
export function readSupervisor(paths: ActivationPaths): SupervisorState | undefined
export function liveSupervisor(paths: ActivationPaths, instanceId?: string, now?: number, states?: readonly SupervisorState['state'][]): SupervisorState | undefined
export function trySourceOperationLock(paths: ActivationPaths, changeId: string, supervisorId: string): (() => void) | undefined
export function validateDetails(input: unknown): ActivationDetails
export function assertAppliedChange(paths: ActivationPaths, input: unknown): ActivationDetails
