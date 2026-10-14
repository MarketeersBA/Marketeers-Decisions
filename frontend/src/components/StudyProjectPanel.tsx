import { useEffect, useState } from "react";

import { useDeleteStudy, useStudies, useUpdateStudy } from "../api/hooks";
import { defaultDataPeriod, normalizeDataPeriod, normalizeDataSource } from "../lib/studyTrustOptions";
import { useSession } from "../stores/sessionStore";
import { useStudyDisplayUnitsSave } from "./StudyDisplayUnitsForm";
import { StudyProjectToolbar } from "./StudyProjectToolbar";

type StudyProjectPanelProps = {
  slug: string;
  onStudyDeleted?: (slug: string) => void;
  onUnselect?: () => void;
};

/** Persistent project actions for the active workspace study. */
export function StudyProjectPanel({ slug, onStudyDeleted, onUnselect }: StudyProjectPanelProps) {
  const { setSession } = useSession();
  const { data: studies, isLoading } = useStudies();
  const updateStudy = useUpdateStudy();
  const deleteStudy = useDeleteStudy();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [dataPeriod, setDataPeriod] = useState(defaultDataPeriod());
  const [dataSource, setDataSource] = useState<string>(normalizeDataSource(""));

  const study = studies?.find((s) => s.slug === slug) ?? null;
  const displayUnits = useStudyDisplayUnitsSave(study?.status === "ready" ? slug : undefined);
  const [syncedSlug, setSyncedSlug] = useState(slug);

  if (study && syncedSlug !== study.slug) {
    setSyncedSlug(study.slug);
    setName(study.name);
    setCompany(study.company);
    setDataPeriod(normalizeDataPeriod(study.dataPeriod ?? ""));
    setDataSource(normalizeDataSource(study.dataSource ?? ""));
    setEditing(false);
  }

  useEffect(() => {
    if (study) {
      setName(study.name);
      setCompany(study.company);
      setDataPeriod(normalizeDataPeriod(study.dataPeriod ?? ""));
      setDataSource(normalizeDataSource(study.dataSource ?? ""));
    }
    setEditing(false);
  }, [slug, study?.slug, study?.name, study?.company, study?.dataPeriod, study?.dataSource]);

  if (isLoading) {
    return <div className="panel data-hub-project-panel">Loading project…</div>;
  }

  if (!study) {
    return null;
  }

  const save = async () => {
    try {
      await updateStudy.mutateAsync({
        slug: study.slug,
        name,
        company,
        data_period: dataPeriod,
        data_source: dataSource,
      });
      if (study.status === "ready") {
        await displayUnits.saveDisplayUnits();
      }
      setEditing(false);
    } catch {
      /* mutation surfaces errors */
    }
  };

  const remove = () => {
    if (!window.confirm(`Delete study "${study.name}" and all its scenarios?`)) return;
    deleteStudy.mutate(study.slug, {
      onSuccess: () => onStudyDeleted?.(study.slug),
    });
  };

  const setDefault = () => {
    updateStudy.mutate({ slug: study.slug, set_default: true });
  };

  const handleUnselect = () => {
    onUnselect?.();
    setSession(null);
  };

  return (
    <section className="data-hub-section data-hub-project-panel" aria-label="Active project">
      <StudyProjectToolbar
        study={study}
        editing={editing}
        name={name}
        company={company}
        busy={false}
        savePending={updateStudy.isPending || displayUnits.isSavingDisplayUnits}
        displayUnitsDraft={study.status === "ready" ? displayUnits : undefined}
        loadError={null}
        dataPeriod={dataPeriod}
        dataSource={dataSource}
        onNameChange={setName}
        onCompanyChange={setCompany}
        onDataPeriodChange={setDataPeriod}
        onDataSourceChange={setDataSource}
        onEdit={() => setEditing(true)}
        onSave={save}
        onCancel={() => {
          setEditing(false);
          setName(study.name);
          setCompany(study.company);
          setDataPeriod(normalizeDataPeriod(study.dataPeriod ?? ""));
          setDataSource(normalizeDataSource(study.dataSource ?? ""));
          displayUnits.reset();
        }}
        onSetDefault={setDefault}
        onUnselect={handleUnselect}
        onRemove={remove}
      />
    </section>
  );
}
