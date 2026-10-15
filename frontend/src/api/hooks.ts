import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";

import type { AnalyticsResponse } from "./analytics_types";
import { serializeAnalyticsParams } from "./analytics_types";
import { api } from "./client";
import type {
  CorridorPreviewRequest,
  CorridorPreviewResponse,
  OptimizerBoundsSku,
  OptimizerBrandSummariesResponse,
  OptimizerBrandSummaryResponse,
  OptimizerContextResponse,
  OptimizerJobResponse,
  OptimizerRunResult,
  OptimizerSetup,
  RunOptimizerRequest,
  RunOptimizerStartResponse,
} from "./optimizer_types";
import { optimizerQueryString } from "./optimizer_types";
import type {
  GridChange,
  GroupRow,
  ScenarioImportPreview,
  ScenarioListItem,
  SessionPayload,
  StudyDataSourcesResponse,
  StudyListItem,
  StudyMetaDisplay,
  ValidationScore,
  ValidationSeriesData,
  ValidationWaveListItem,
  ValidationWaveUploadResult,
} from "./types";


export function useStudies() {
  return useQuery({
    queryKey: ["studies"],
    queryFn: () => api.get<StudyListItem[]>("/api/studies"),
  });
}

export function useStudyDataSources(slug: string | undefined) {
  return useQuery({
    queryKey: ["studyDataSources", slug],
    queryFn: () => api.get<StudyDataSourcesResponse>(`/api/studies/${slug}/data-sources`),
    enabled: Boolean(slug),
  });
}

export function useReplaceStudyDesignSource(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.upload<StudyDataSourcesResponse>(
        `/api/studies/${slug}/data-sources/design`,
        fd,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["studyDataSources", slug] });
      qc.invalidateQueries({ queryKey: ["studies"] });
    },
  });
}

export function useReplaceStudyHbuSource(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.upload<StudyDataSourcesResponse>(
        `/api/studies/${slug}/data-sources/hbu`,
        fd,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["studyDataSources", slug] });
      qc.invalidateQueries({ queryKey: ["studies"] });
    },
  });
}

export function useScenarios(slug: string | undefined) {
  return useQuery({
    queryKey: ["scenarios", slug],
    queryFn: () => api.get<ScenarioListItem[]>(`/api/studies/${slug}/scenarios`),
    enabled: Boolean(slug),
  });
}

export function useValidationScore(slug: string | undefined, scenarioName: string | undefined) {
  return useQuery({
    queryKey: ["validationScore", slug, scenarioName],
    queryFn: () =>
      api.get<ValidationScore>(
        `/api/studies/${slug}/validation/score?scenario=${encodeURIComponent(scenarioName!)}`,
      ),
    enabled: Boolean(slug && scenarioName),
    staleTime: 30_000,
  });
}

export function useValidationWaves(slug: string | undefined) {
  return useQuery({
    queryKey: ["validationWaves", slug],
    queryFn: () =>
      api.get<{ waves: ValidationWaveListItem[] }>(`/api/studies/${slug}/validation`),
    enabled: Boolean(slug),
  });
}

export function useValidationSeries(slug: string | undefined) {
  return useQuery({
    queryKey: ["validationSeries", slug],
    queryFn: () =>
      api.get<ValidationSeriesData>(`/api/studies/${slug}/validation/series`),
    enabled: Boolean(slug),
  });
}

export function useUploadValidationWave(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.upload<ValidationWaveUploadResult>(
        `/api/studies/${slug}/validation/upload`,
        fd,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["validationWaves", slug] });
      qc.invalidateQueries({ queryKey: ["validationSeries", slug] });
    },
  });
}

export function useDeleteValidationWave(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (waveId: string) =>
      api.del<{ deleted: string }>(`/api/studies/${slug}/validation/${waveId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["validationWaves", slug] });
      qc.invalidateQueries({ queryKey: ["validationSeries", slug] });
    },
  });
}

export function useLoadSession() {
  return useMutation({
    mutationFn: (slug: string) => api.post<SessionPayload>("/api/sessions", { slug }),
  });
}

export function useRecalculate() {
  return useMutation({
    mutationFn: ({ sessionId, changes }: { sessionId: string; changes: GridChange[] }) =>
      api.post<SessionPayload>(`/api/sessions/${sessionId}/recalculate`, { changes }),
  });
}

export function useResetSession() {
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<SessionPayload>(`/api/sessions/${sessionId}/reset`),
  });
}

export function useApplySegmentation() {
  return useMutation({
    mutationFn: ({
      sessionId,
      assignment_key,
      member,
      filters,
    }: {
      sessionId: string;
      assignment_key?: string | null;
      member?: string | null;
      filters?: { assignment_key: string; member: string }[] | null;
    }) =>
      api.post<SessionPayload>(`/api/sessions/${sessionId}/segmentation`, {
        assignment_key: assignment_key ?? null,
        member: member ?? null,
        filters: filters ?? undefined,
      }),
  });
}

export function useAnalytics(
  slug: string | undefined,
  type: string,
  params: Record<string, string | undefined> = {},
  options?: { enabled?: boolean },
) {
  const paramsKey = serializeAnalyticsParams(params);
  return useQuery({
    queryKey: ["analytics", slug, type, paramsKey],
    queryFn: () => {
      const p = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v) p.set(k, v);
      });
      const qs = p.toString();
      return api.get<AnalyticsResponse>(
        `/api/studies/${slug}/analytics/${type}${qs ? `?${qs}` : ""}`,
      );
    },
    enabled: options?.enabled ?? Boolean(slug && type),
  });
}

export function useGroups() {
  return useMutation({
    mutationFn: ({ sessionId, groupType }: { sessionId: string; groupType: string }) =>
      api.get<{ groups: GroupRow[] }>(
        `/api/sessions/${sessionId}/groups?group_type=${encodeURIComponent(groupType)}`,
      ),
  });
}

export function useApplyScenario() {
  return useMutation({
    mutationFn: ({ sessionId, name }: { sessionId: string; name: string }) =>
      api.post<SessionPayload>(`/api/sessions/${sessionId}/apply-scenario`, { name }),
  });
}

/** Apply competitor price moves, save as a named scenario, return the loaded session. */
export function useCompetitorReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      group_type,
      moves,
      name,
      description,
    }: {
      sessionId: string;
      group_type: string;
      moves: { brand: string; pct: number }[];
      name?: string;
      description?: string;
    }) =>
      api.post<SessionPayload>(`/api/sessions/${sessionId}/competitor-reaction`, {
        group_type,
        moves,
        name: name ?? "",
        description: description ?? "",
      }),
    onSuccess: (payload) => {
      if (payload.slug) {
        qc.invalidateQueries({ queryKey: ["scenarios", payload.slug] });
      }
    },
  });
}

export function useSaveScenario(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      session_id: string;
      name: string;
      description: string;
      validation: boolean;
    }) => api.post(`/api/studies/${slug}/scenarios`, body),
    onSuccess: (_data, variables) => {
      if (slug) {
        qc.invalidateQueries({ queryKey: ["scenarios", slug] });
        if (variables.validation) {
          qc.invalidateQueries({ queryKey: ["validationScore", slug, variables.name] });
        }
      }
    },
  });
}

export function useDeleteScenario(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.del(`/api/studies/${slug}/scenarios/${encodeURIComponent(name)}`),
    onSuccess: () => {
      if (slug) qc.invalidateQueries({ queryKey: ["scenarios", slug] });
    },
  });
}

export function useSeedBaseScenario(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; name: string; created: boolean }>(
        `/api/studies/${slug}/scenarios/seed-base`,
      ),
    onSuccess: () => {
      if (slug) qc.invalidateQueries({ queryKey: ["scenarios", slug] });
    },
  });
}

export function useUpdateStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      name,
      company,
      set_default,
      data_period,
      data_source,
    }: {
      slug: string;
      name?: string;
      company?: string;
      set_default?: boolean;
      data_period?: string;
      data_source?: string;
    }) =>
      api.patch(`/api/studies/${slug}`, {
        name,
        company,
        set_default,
        data_period,
        data_source,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["studies"] }),
  });
}

export function useStudyMeta(slug: string | undefined) {
  return useQuery({
    queryKey: ["study-meta", slug],
    queryFn: () =>
      api.get<StudyMetaDisplay>(`/api/studies/${slug}/meta`),
    enabled: Boolean(slug),
  });
}

export function usePatchStudyMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      price_currency_symbol,
      size_unit_label,
    }: {
      slug: string;
      price_currency_symbol?: string;
      size_unit_label?: string;
    }) =>
      api.patch<StudyMetaDisplay>(`/api/studies/${slug}/meta`, {
        price_currency_symbol,
        size_unit_label,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["study-meta", vars.slug] });
    },
  });
}

export function useDeleteStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.del(`/api/studies/${slug}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["studies"] }),
  });
}

export function useReorderScenarios(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (order: string[]) =>
      api.patch(`/api/studies/${slug}/scenarios/order`, { order }),
    onSuccess: () => {
      if (slug) qc.invalidateQueries({ queryKey: ["scenarios", slug] });
    },
  });
}

export function usePreviewScenarioImport(slug: string | undefined) {
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.upload<{ previews: ScenarioImportPreview[] }>(
        `/api/studies/${slug}/scenarios/import/preview`,
        fd,
      );
    },
  });
}

export function useImportScenarios(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, names }: { file: File; names?: string[] }) => {
      const fd = new FormData();
      fd.append("file", file);
      if (names?.length) fd.append("names", names.join(","));
      return api.upload<{ imported: number; names: string[] }>(
        `/api/studies/${slug}/scenarios/import`,
        fd,
      );
    },
    onSuccess: () => {
      if (slug) qc.invalidateQueries({ queryKey: ["scenarios", slug] });
    },
  });
}

export function useExportSession() {
  return useMutation({
    mutationFn: ({
      sessionId,
      format,
      filename,
    }: {
      sessionId: string;
      format: "csv" | "xlsx";
      filename: string;
    }) => api.download(`/api/sessions/${sessionId}/export?format=${format}`, filename),
  });
}

export function useUploadDesign() {
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.upload<{
        wizard_id: string;
        meta: any;
        products: any[];
        attributes: any[];
        groups: any[];
        segments: any[];
      }>("/api/wizard/design", fd);
    },
  });
}

export function useUploadHbu() {
  return useMutation({
    mutationFn: ({ wizardId, file }: { wizardId: string; file: File }) => {
      const fd = new FormData();
      fd.append("wizard_id", wizardId);
      fd.append("file", file);
      return api.upload<{ respondent_count: number; columns: string[] }>(
        "/api/wizard/hbu",
        fd,
      );
    },
  });
}

export function useCreateStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      wizard_id: string;
      name: string;
      company: string;
      category: string;
      market: string;
      exponent_factor: number;
      msu: number;
      su: number;
      vsu: number;
      price_currency_symbol: string;
      size_unit_label: string;
      design_source_filename?: string;
      hbu_source_filename?: string;
      data_period?: string;
      data_source?: string;
      allow_overwrite?: boolean;
      auto_disambiguate?: boolean;
    }) =>
      api.post<{ slug: string; name: string; company: string }>(
        "/api/studies",
        body,
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["studies"] });
      qc.invalidateQueries({ queryKey: ["studyDataSources", data.slug] });
    },
  });
}

export function useCompareScenarios(slug: string | undefined) {
  return useMutation({
    mutationFn: (scenarios: string[]) =>
      api.post<{
        base: { results: any[]; groups: Record<string, any[]> };
        scenarios: Record<
          string,
          { results: any[]; groups: Record<string, any[]> }
        >;
        groupTypes: string[];
      }>(`/api/studies/${slug}/compare`, { scenarios }),
  });
}

export function useExportComparison(slug: string | undefined) {
  return useMutation({
    mutationFn: ({
      scenarios,
      filename,
    }: {
      scenarios: string[];
      filename: string;
    }) =>
      api.postDownload(`/api/studies/${slug}/compare/export`, { scenarios }, filename),
  });
}

/** Catalog queries stay warm when navigating to the simulator and back. */
const OPTIMIZER_STALE_MS = 5 * 60 * 1000;

export function useOptimizerContext(
  slug: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["optimizer", "context", slug],
    queryFn: () => api.get<OptimizerContextResponse>(`/api/${slug}/optimizer/context`),
    enabled: (options?.enabled ?? true) && Boolean(slug),
    staleTime: OPTIMIZER_STALE_MS,
  });
}

export function useOptimizerBrandSummary(
  slug: string | undefined,
  groupType: string | undefined,
  brand: string | undefined,
  setup: OptimizerSetup,
  options?: { enabled?: boolean },
) {
  const setupKey = JSON.stringify(setup);
  return useQuery({
    queryKey: ["optimizer", "brand-summary", slug, groupType, brand, setupKey],
    queryFn: () => {
      const qs = optimizerQueryString(setup);
      return api.get<OptimizerBrandSummaryResponse>(
        `/api/${slug}/optimizer/brand-summary?group_type=${encodeURIComponent(groupType!)}&brand=${encodeURIComponent(brand!)}${qs}`,
      );
    },
    enabled: (options?.enabled ?? true) && Boolean(slug && groupType && brand),
    staleTime: OPTIMIZER_STALE_MS,
  });
}

/** Fetch SKU catalogs for every brand in one study load (focus SKUs + competitor anchors). */
export function useOptimizerBrandSummaries(
  slug: string | undefined,
  groupType: string | undefined,
  setup: OptimizerSetup,
  options?: { enabled?: boolean },
) {
  const setupKey = JSON.stringify(setup);
  return useQuery({
    queryKey: ["optimizer", "brand-summaries", slug, groupType, setupKey],
    queryFn: () => {
      const qs = optimizerQueryString(setup);
      return api.get<OptimizerBrandSummariesResponse>(
        `/api/${slug}/optimizer/brand-summaries?group_type=${encodeURIComponent(groupType!)}${qs}`,
      );
    },
    enabled: (options?.enabled ?? true) && Boolean(slug && groupType),
    staleTime: OPTIMIZER_STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export function useCorridorPreview(
  slug: string | undefined,
  body: CorridorPreviewRequest | null,
  options?: { enabled?: boolean },
) {
  const bodyKey = body ? JSON.stringify(body) : "";
  return useQuery({
    queryKey: ["optimizer", "corridor-preview", slug, bodyKey],
    queryFn: () =>
      api.post<CorridorPreviewResponse>(`/api/${slug}/optimizer/corridor-preview`, body),
    enabled: (options?.enabled ?? true) && Boolean(slug && body),
    placeholderData: keepPreviousData,
    staleTime: OPTIMIZER_STALE_MS,
  });
}

export function useOptimizerBounds(
  slug: string | undefined,
  groupType: string | undefined,
  brand: string | undefined,
  setup: OptimizerSetup,
  options?: { enabled?: boolean },
) {
  const setupKey = JSON.stringify(setup);
  return useQuery({
    queryKey: ["optimizer", "bounds", slug, groupType, brand, setupKey],
    queryFn: () => {
      const qs = optimizerQueryString(setup);
      return api.get<OptimizerBoundsSku[]>(
        `/api/${slug}/optimizer/bounds?group_type=${encodeURIComponent(groupType!)}&brand=${encodeURIComponent(brand!)}${qs}`,
      );
    },
    enabled: (options?.enabled ?? true) && Boolean(slug && groupType && brand),
    staleTime: OPTIMIZER_STALE_MS,
  });
}

const OPTIMIZER_POLL_MS = 500;

export interface OptimizerJobOutcome {
  jobId: string;
  result: OptimizerRunResult;
}

export async function runOptimizerJob(
  slug: string,
  body: RunOptimizerRequest,
  onProgress?: (evals: number, estimatedEvals: number) => void,
  signal?: AbortSignal,
): Promise<OptimizerJobOutcome> {
  const start = await api.post<RunOptimizerStartResponse>(
    `/api/${slug}/optimizer/run`,
    body,
  );
  onProgress?.(0, start.estimated_evals);

  while (true) {
    if (signal?.aborted) {
      throw new Error("Optimization cancelled");
    }
    const job = await api.get<OptimizerJobResponse>(
      `/api/${slug}/optimizer/jobs/${start.job_id}`,
    );
    onProgress?.(job.evals, job.estimated_evals || start.estimated_evals);
    if (job.status === "done") {
      if (!job.result) {
        throw new Error("Optimization finished without a result");
      }
      return { jobId: start.job_id, result: job.result };
    }
    if (job.status === "error") {
      throw new Error(job.error ?? "Optimization failed");
    }
    if (job.status === "cancelled") {
      throw new Error("Optimization cancelled");
    }
    await new Promise((resolve) => setTimeout(resolve, OPTIMIZER_POLL_MS));
  }
}

export async function saveOptimizerScenario(
  slug: string,
  jobId: string,
  description = "",
  name = "",
): Promise<{ scenario_name: string }> {
  return api.post<{ ok: boolean; scenario_name: string }>(
    `/api/${slug}/optimizer/jobs/${jobId}/save-scenario`,
    { name, description },
  );
}
