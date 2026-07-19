import { z } from "zod";

const identifierSchema = z.union([z.string(), z.number()]).transform(String);

const channelSchema = z.object({
  id: identifierSchema,
  name: z.string(),
});

const channelEnvelopeSchema = z.union([
  z.array(channelSchema),
  z.object({ results: z.array(channelSchema) }).transform(({ results }) => results),
]);

const itemSchema = z
  .object({
    id: identifierSchema,
    status: z.string().optional(),
    usage_usd: z.number().optional(),
    usageUsd: z.number().optional(),
    usage_site_count: z.number().int().nonnegative().optional(),
    usageSiteCount: z.number().int().nonnegative().optional(),
    sampled_at: z.string().optional(),
    sampledAt: z.string().optional(),
  })
  .transform((item) => ({
    id: item.id,
    ...(item.status === undefined ? {} : { status: item.status }),
    ...(item.usage_usd === undefined && item.usageUsd === undefined
      ? {}
      : { usageUsd: item.usage_usd ?? item.usageUsd }),
    ...(item.usage_site_count === undefined && item.usageSiteCount === undefined
      ? {}
      : { usageSiteCount: item.usage_site_count ?? item.usageSiteCount }),
    ...(item.sampled_at === undefined && item.sampledAt === undefined
      ? {}
      : { sampledAt: item.sampled_at ?? item.sampledAt }),
  }));

const itemsEnvelopeSchema = z.union([
  z.array(itemSchema).transform((items) => ({ items, nextCursor: null })),
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

const submissionResultSchema = z
  .object({
    success: z.boolean(),
    itemIds: z.array(identifierSchema).optional(),
    item_ids: z.array(identifierSchema).optional(),
  })
  .transform((result) => ({
    success: result.success,
    itemIds: result.itemIds ?? result.item_ids ?? [],
  }));

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
export type UpstreamSubmissionResult = z.output<typeof submissionResultSchema>;
export type UpstreamBatchSummary = z.output<typeof batchSummarySchema>;
export type UpstreamBatchNote = z.output<typeof batchNoteSchema>;

export interface SubmitKeyRow {
  apiKey: string;
  warrantyHours: number;
}
