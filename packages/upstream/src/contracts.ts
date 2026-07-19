import { z } from "zod";

const identifierSchema = z.union([z.string(), z.number()]).transform(String);
const numericAmountSchema = z
  .union([
    z.number().nonnegative(),
    z.string().trim().regex(/^\d+(?:\.\d+)?$/u).transform(Number),
  ])
  .refine(Number.isFinite);

function normalizeAccessStatus(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "success") return "通过";
  if (normalized === "failed") return "失败";
  if (normalized === "testing") return "测试中";
  if (normalized === "untested") return "未测试";
  return status;
}

const channelSchema = z
  .object({
    id: identifierSchema,
    name: z.string(),
    source_type: z.string().optional(),
    sourceType: z.string().optional(),
  })
  .transform((channel) => ({
    id: channel.id,
    name: channel.name,
    ...(channel.source_type === undefined && channel.sourceType === undefined
      ? {}
      : { sourceType: channel.source_type ?? channel.sourceType }),
  }));

const channelEnvelopeSchema = z.union([
  z.array(channelSchema),
  z.object({ results: z.array(channelSchema) }).transform(({ results }) => results),
  z.object({ channels: z.array(channelSchema) }).transform(({ channels }) => channels),
]);

const itemSchema = z
  .object({
    id: identifierSchema,
    status: z.string().optional(),
    access_test_status: z.string().optional(),
    usage_usd: z.number().optional(),
    usageUsd: z.number().optional(),
    usage_amount: numericAmountSchema.optional(),
    usage_site_count: z.number().int().nonnegative().optional(),
    usageSiteCount: z.number().int().nonnegative().optional(),
    sampled_at: z.string().optional(),
    sampledAt: z.string().optional(),
    usage_sampled_at: z.string().optional(),
  })
  .transform((item) => ({
    id: item.id,
    ...(item.status === undefined && item.access_test_status === undefined
      ? {}
      : {
          status: item.access_test_status === undefined
            ? item.status
            : normalizeAccessStatus(item.access_test_status),
        }),
    ...(item.usage_usd === undefined
      && item.usageUsd === undefined
      && item.usage_amount === undefined
      ? {}
      : { usageUsd: item.usage_amount ?? item.usage_usd ?? item.usageUsd }),
    ...(item.usage_site_count === undefined && item.usageSiteCount === undefined
      ? {}
      : { usageSiteCount: item.usage_site_count ?? item.usageSiteCount }),
    ...(item.sampled_at === undefined
      && item.sampledAt === undefined
      && item.usage_sampled_at === undefined
      ? {}
      : { sampledAt: item.usage_sampled_at ?? item.sampled_at ?? item.sampledAt }),
  }));

const itemsEnvelopeSchema = z.union([
  z.array(itemSchema).transform((items) => ({ items, nextCursor: null })),
  z.object({ items: z.array(itemSchema) }).transform(({ items }) => ({
    items,
    nextCursor: null,
  })),
  z
    .object({
      results: z.array(itemSchema),
      next: z.string().nullable().optional(),
      next_cursor: z.string().nullable().optional(),
    })
    .transform((page) => ({
      items: page.results,
      nextCursor: page.next_cursor ?? page.next ?? null,
    })),
]);

const submissionResultSchema = z.object({
  results: z.array(
    z.object({
      row_id: z.string(),
      status: z.enum(["submitted", "failed"]),
      message: z.string().optional(),
      item: z.object({ id: identifierSchema }).passthrough().optional(),
    }),
  ),
});

const batchSummarySchema = z
  .object({
    total: z.number().int().nonnegative().optional(),
    healthy: z.number().int().nonnegative().optional(),
    usage_usd: z.number().nonnegative().optional(),
    usageUsd: z.number().nonnegative().optional(),
  })
  .passthrough()
  .refine(
    (summary) =>
      summary.total !== undefined
      || summary.healthy !== undefined
      || summary.usage_usd !== undefined
      || summary.usageUsd !== undefined,
  )
  .transform((summary) => ({
    ...(summary.total === undefined ? {} : { total: summary.total }),
    ...(summary.healthy === undefined ? {} : { healthy: summary.healthy }),
    ...(summary.usage_usd === undefined && summary.usageUsd === undefined
      ? {}
      : { usageUsd: summary.usage_usd ?? summary.usageUsd }),
  }));

const batchNoteSchema = z
  .object({
    id: identifierSchema,
    message: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((entry) => entry.message !== undefined || entry.note !== undefined)
  .transform((entry) => ({
    id: entry.id,
    message: entry.message ?? entry.note ?? "",
  }));

const batchNotesSchema = z.union([
  z.array(batchNoteSchema),
  z.object({ results: z.array(batchNoteSchema) }).transform(({ results }) => results),
]);

export const contracts = {
  channels: channelEnvelopeSchema,
  items: itemsEnvelopeSchema,
  submission: submissionResultSchema,
  batchSummary: batchSummarySchema,
  batchNotes: batchNotesSchema,
};

export type UpstreamChannel = z.output<typeof channelSchema>;
export type UpstreamItemsPage = z.output<typeof itemsEnvelopeSchema>;
export type UpstreamSubmissionResponse = z.output<typeof submissionResultSchema>;
export interface UpstreamSubmissionResult {
  success: boolean;
  itemIds: string[];
}
export type UpstreamBatchSummary = z.output<typeof batchSummarySchema>;
export type UpstreamBatchNote = z.output<typeof batchNoteSchema>;

export interface SubmitKeyRow {
  apiKey: string;
  warrantyHours: number;
}
