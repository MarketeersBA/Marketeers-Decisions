import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  useDeleteStudy,
  useLoadSession,
  useStudies,
  useUpdateStudy,
} from "../api/hooks";
import { defaultDataPeriod, normalizeDataPeriod, normalizeDataSource } from "../lib/studyTrustOptions";
import { fmtDate } from "../shell/format";
import { useSession } from "../stores/sessionStore";
import { useStudyDisplayUnitsSave } from "./StudyDisplayUnitsForm";
import { StudyProjectToolbar } from "./StudyProjectToolbar";

function StudyRow({
  study,
  selected,
  activating,
  onActivate,
}: {
  study: { slug: string; name: string; company: string; status: string; isDefault: boolean; createdAt: string };
  selected: boolean;
  activating: boolean;
  onActivate: (slug: string) => void;
}) {
  return (
    <tr
      className={selected ? "studies-row-selected" : undefined}
      onClick={() => onActivate(study.slug)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(study.slug);
        }
      }}
      tabIndex={0}
      aria-selected={selected}
      aria-busy={activating}
    >
      <td className="studies-select-cell">
        <span className={`studies-select-dot${selected ? " is-selected" : ""}`} aria-hidden />
      </td>
      <td dir="auto" className="studies-name-cell">
        <div className="studies-name-wrap">
          <span className="studies-name">{study.name}</span>
          {study.isDefault ? <span className="studies-default-badge">Default</span> : null}
        </div>
      </td>
      <td>{study.company}</td>
      <td>
        <span className={`status ${study.status}`}>{study.status}</span>
      </td>
      <td className="studies-date">{fmtDate(study.createdAt)}</td>
    </tr>
  );
}

type StudyManagerProps = {
  activeSlug?: string | null;
  navigateOnOpen?: boolean;
  onOpenSuccess?: () => void;
  onStudyDeleted?: (slug: string) => void;
  onUnselect?: () => void;
  /** When false, only the study table is shown (toolbar lives elsewhere). */
  showToolbar?: boolean;
};

export function StudyManager({
  activeSlug = null,
  navigateOnOpen = true,
  onOpenSuccess,
  onStudyDeleted,
  onUnselect,
  showToolbar = true,
}: StudyManagerProps) {
  const { data: studies, isLoading, isError, error } = useStudies();
  const loadSession = useLoadSession();
  const updateStudy = useUpdateStudy();
  const deleteStudy = useDeleteStudy();
  const { session, setSession } = useSession();
  const navigate = useNavigate();
  const [toolbarSlug, setToolbarSlug] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [dataPeriod, setDataPeriod] = useState(defaultDataPeriod());
  const [dataSource, setDataSource] = useState<string>(normalizeDataSource(""));
  const resolvedToolbarSlug = activeSlug ?? toolbarSlug ?? (session?.slug ?? null);
  const highlightSlug = pendingSlug ?? activeSlug ?? toolbarSlug ?? (session?.slug ?? null);
  const toolbarStudy = studies?.find((s) => s.slug === resolvedToolbarSlug) ?? null;
  const displayUnits = useStudyDisplayUnitsSave(
    showToolbar && toolbarStudy?.status === "ready" ? toolbarStudy.slug : undefined,
  );

  useEffect(() => {
    if (activeSlug) {
      setToolbarSlug(null);
      setLoadError(null);
    }
  }, [activeSlug]);

  useEffect(() => {
    if (toolbarStudy) {
      setName(toolbarStudy.name);
      setCompany(toolbarStudy.company);
      setDataPeriod(normalizeDataPeriod(toolbarStudy.dataPeriod ?? ""));
      setDataSource(normalizeDataSource(toolbarStudy.dataSource ?? ""));
    }
    setEditing(false);
  }, [
    resolvedToolbarSlug,
    toolbarStudy?.slug,
    toolbarStudy?.name,
    toolbarStudy?.company,
    toolbarStudy?.dataPeriod,
    toolbarStudy?.dataSource,
  ]);

  const handleUnselect = () => {
    setEditing(false);
    setToolbarSlug(null);
    setPendingSlug(null);
    setSession(null);
    onUnselect?.();
  };

  const activateRow = (slug: string) => {
    if (loadSession.isPending && pendingSlug === slug) return;

    const isSelected =
      slug === highlightSlug ||
      slug === activeSlug ||
      slug === toolbarSlug ||
      (session ? slug === session.slug : false);

    if (isSelected && !loadSession.isPending) {
      handleUnselect();
      return;
    }

    setLoadError(null);
    setPendingSlug(slug);

    loadSession.mutate(slug, {
      onSuccess: (payload) => {
        setPendingSlug(null);
        setToolbarSlug(null);
        setSession(payload);
        onOpenSuccess?.();
        if (navigateOnOpen) {
          navigate("/optimizer");
        }
      },
      onError: (err) => {
        setPendingSlug(null);
        setLoadError(err instanceof Error ? err.message : "Failed to open study.");
      },
    });
  };

  const save = async () => {
    if (!toolbarStudy) return;
    try {
      await updateStudy.mutateAsync({
        slug: toolbarStudy.slug,
        name,
        company,
        data_period: dataPeriod,
        data_source: dataSource,
      });
      if (toolbarStudy.status === "ready") {
        await displayUnits.saveDisplayUnits();
      }
      setEditing(false);
    } catch {
      /* mutation surfaces errors */
    }
  };

  const remove = () => {
    if (!toolbarStudy) return;
    if (!window.confirm(`Delete study "${toolbarStudy.name}" and all its scenarios?`)) return;
    const deletedSlug = toolbarStudy.slug;
    deleteStudy.mutate(deletedSlug, {
      onSuccess: () => {
        setToolbarSlug(null);
        setLoadError(null);
        onStudyDeleted?.(deletedSlug);
      },
    });
  };

  const setDefault = () => {
    if (!toolbarStudy) return;
    updateStudy.mutate({ slug: toolbarStudy.slug, set_default: true });
  };

  if (isLoading) return <div className="panel">Loading studies…</div>;
  if (isError) {
    return <div className="panel error">Failed to load studies: {(error as Error).message}</div>;
  }

  return (
    <div className="studies-panel">
      {!studies || studies.length === 0 ? (
        <div className="studies-panel-empty">
          No studies yet. Use the upload section below to create one.
        </div>
      ) : (
        <>
          {loadError ? <p className="study-project-toolbar-error">{loadError}</p> : null}
          {showToolbar && toolbarStudy ? (
            <StudyProjectToolbar
              study={toolbarStudy}
              editing={editing}
              name={name}
              company={company}
              dataPeriod={dataPeriod}
              dataSource={dataSource}
              busy={loadSession.isPending}
              savePending={updateStudy.isPending || displayUnits.isSavingDisplayUnits}
              displayUnitsDraft={toolbarStudy.status === "ready" ? displayUnits : undefined}
              loadError={null}
              onNameChange={setName}
              onCompanyChange={setCompany}
              onDataPeriodChange={setDataPeriod}
              onDataSourceChange={setDataSource}
              onEdit={() => setEditing(true)}
              onSave={save}
              onCancel={() => {
                setEditing(false);
                setName(toolbarStudy.name);
                setCompany(toolbarStudy.company);
                setDataPeriod(normalizeDataPeriod(toolbarStudy.dataPeriod ?? ""));
                setDataSource(normalizeDataSource(toolbarStudy.dataSource ?? ""));
                displayUnits.reset();
              }}
              onSetDefault={setDefault}
              onUnselect={handleUnselect}
              onRemove={remove}
            />
          ) : null}
          <div className="studies-table-wrap">
            <table className="studies-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Study Name</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {studies.map((s) => (
                  <StudyRow
                    key={s.slug}
                    study={s}
                    selected={highlightSlug === s.slug}
                    activating={pendingSlug === s.slug && loadSession.isPending}
                    onActivate={activateRow}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
