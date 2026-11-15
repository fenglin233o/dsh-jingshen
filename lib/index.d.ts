import s from "@deepseek-ai/schemastery";
import { z } from "zod";
import { Context } from "@deepseek-ai/cordis";
declare const name = "dsh-jingshen";
declare const inject: string[];
interface SpiritConfig {
  stateDir: string;
  concurrency: number;
  maxRevisions: number;
  sourceRoot: string;
  harnessSourceRoot: string;
}
declare const Config: s<Partial<SpiritConfig>, SpiritConfig>;
declare const SessionsInput: z.ZodDiscriminatedUnion<[z.ZodObject<{
  action: z.ZodLiteral<"list">;
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"read">;
  sessionId: z.ZodString;
  beforeSeq: z.ZodOptional<z.ZodNumber>;
  throughSeq: z.ZodOptional<z.ZodNumber>;
  maxMessages: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"search">;
  query: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"models">;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"create">;
  title: z.ZodString;
  cwd: z.ZodOptional<z.ZodString>;
  selection: z.ZodOptional<z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    reasoningEffort: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>>;
  reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"post">;
  sessionId: z.ZodString;
  text: z.ZodString;
  requestId: z.ZodOptional<z.ZodString>;
  mode: z.ZodDefault<z.ZodEnum<{
    queue: "queue";
    steer: "steer";
    context: "context";
  }>>;
  reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"model">;
  sessionId: z.ZodString;
  selection: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    reasoningEffort: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>;
  reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"stop">;
  sessionId: z.ZodString;
  reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"watch">;
  sessionId: z.ZodString;
  reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"unwatch">;
  sessionId: z.ZodString;
}, z.core.$strict>], "action">;
declare const ChangeInput: z.ZodDiscriminatedUnion<[z.ZodObject<{
  reason: z.ZodString;
  evidence: z.ZodDefault<z.ZodArray<z.ZodString>>;
  priorLimitations: z.ZodString;
  retainedContent: z.ZodDefault<z.ZodArray<z.ZodString>>;
  criteria: z.ZodArray<z.ZodString>;
  criterionChanges: z.ZodDefault<z.ZodArray<z.ZodObject<{
    previous: z.ZodString;
    replacement: z.ZodString;
    reason: z.ZodString;
  }, z.core.$strict>>>;
  targets: z.ZodArray<z.ZodString>;
  parentId: z.ZodOptional<z.ZodUUID>;
  action: z.ZodLiteral<"begin">;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"list">;
  offset: z.ZodDefault<z.ZodNumber>;
  limit: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"read">;
  id: z.ZodUUID;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"compare">;
  id: z.ZodUUID;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"verify">;
  id: z.ZodUUID;
  checks: z.ZodArray<z.ZodObject<{
    target: z.ZodString;
    command: z.ZodString;
    cwd: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>>;
  timeoutMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"apply">;
  id: z.ZodUUID;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"rollback">;
  id: z.ZodUUID;
}, z.core.$strict>, z.ZodObject<{
  action: z.ZodLiteral<"activate">;
  id: z.ZodUUID;
  reason: z.ZodString;
}, z.core.$strict>], "action">;
declare function apply(ctx: Context, config: ReturnType<typeof Config>): Promise<void>;
export { ChangeInput, Config, SessionsInput, SpiritConfig, apply, inject, name };