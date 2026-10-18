import { useRef, useState } from "react";

import {
  useReplaceStudyDesignSource,
  useReplaceStudyHbuSource,
  useReplaceStudyUnitCosts,
  useStudyDataSources,
} from "../api/hooks";
import { ApiError, api } from "../api/client";
import type { SessionPayload, StudyDataSource } from "../api/types";
import { useSession } from "../stores/sessionStore";
import { fmtDate } from "../shell/format";

type DataSourcesSectionProps = {
  slug: string;
};

function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Update failed";
}

export function DataSourcesSection({ slug }: DataSourcesSectionProps) {
  const { data, isLoading, isError, error } = useStudyDataSources(slug);
  const replaceDesign = useReplaceStudyDesignSource(slug);
  const replaceHbu = useReplaceStudyHbuSource(slug);
  const replaceUnitCosts = useReplaceStudyUnitCosts(slug);
  const { session, setSession } = useSession();
  const designInputRef = useRef<HTMLInputElement>(null);
  const hbuInputRef = useRef<HTMLInputElement>(null);
  const unitCostInputRef = useRef<HTMLInputElement>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [rowWarnings, setRowWarnings] = useState<string[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const refreshSessionIfActive = async () => {
    if (!session?.sessionId || session.slug !== slug) return;
    try {
      const payload = await api.post<SessionPayload>(
        `/api/sessions/${session.sessionId}/recalculate`,
        { changes: [] },
      );
      setSession(payload);
    } catch {
      /* session may have expired; list refresh still applied */
    }
  };

  const handleFile = async (source: StudyDataSource, file: File | null | undefined) => {
    if (!file) return;
    setRowError(null);
    setRowWarnings([]);
    setUpdatingId(source.id);
    try {
      if (source.id === "design") {
        const res = await replaceDesign.mutateAsync(file);
        setRowWarnings(res.warnings ?? []);
      } else if (source.id === "unit-costs") {
        await replaceUnitCosts.mutateAsync(file);
      } else {
        await replaceHbu.mutateAsync(file);
      }
      await refreshSessionIfActive();
    } catch (e) {
      setRowError({ id: source.id, message: uploadErrorMessage(e) });
    } finally {
      setUpdatingId(null);
    }
  };

  if (isLoading) {
    return <div className="panel data-sources-loading">Loading data sources…</div>;
  }

  if (isError) {
    return (
      <div className="panel error data-sources-error">
        Failed to load data sources: {(error as Error).message}
      </div>
    );
  }

  const sources = data?.sources ?? [];

  return (
    <section className="data-sources-card" aria-labelledby="data-sources-heading">
      <header className="data-sources-header">
        <h2 id="data-sources-heading" className="data-sources-title">
          Data sources
        </h2>
        <p className="data-sources-subtitle">What&apos;s feeding the simulator right now</p>
      </header>
      <input
        ref={designInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="data-source-file-input"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const source = sources.find((s) => s.id === "design");
          if (source) void handleFile(source, e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={hbuInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="data-source-file-input"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const source = sources.find((s) => s.id === "hbu");
          if (source) void handleFile(source, e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={unitCostInputRef}
        type="file"
        accept=".csv,text/csv"
        className="data-source-file-input"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const source = sources.find((s) => s.id === "unit-costs");
          if (source) void handleFile(source, e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {rowWarnings.length > 0 ? (
        <div className="banner-warn mb-16" role="status">
          <div className="warn-title">Import Warning</div>
          <ul className="banner-warn-list">
            {rowWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="data-sources-list">
        {sources.map((source) => {
          const busy = updatingId === source.id;
          return (
            <li key={source.id} className="data-sources-row">
              <span className="data-source-avatar" aria-hidden>
                {source.initials}
              </span>
              <div className="data-source-body">
                <div className="data-source-title">{source.title}</div>
                <div className="data-source-description">{source.description}</div>
                <div className="data-source-updated">
                  Last updated {fmtDate(source.updatedAt)}
                </div>
                {rowError?.id === source.id ? (
                  <p className="data-source-error" role="alert">
                    {rowError.message}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="data-source-update"
                disabled={busy}
                onClick={() => {
                  if (source.id === "design") designInputRef.current?.click();
                  else if (source.id === "unit-costs") unitCostInputRef.current?.click();
                  else hbuInputRef.current?.click();
                }}
              >
                {busy ? "Updating…" : "Update"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
