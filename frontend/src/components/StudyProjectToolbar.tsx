import { Link } from "react-router-dom";

import type { StudyListItem } from "../api/types";
import type { StudyDisplayUnitsDraft } from "../hooks/useStudyDisplayUnitsDraft";
import { StudyDisplayUnitsForm } from "./StudyDisplayUnitsForm";
import { StudyTrustFields } from "./StudyTrustFields";

type StudyProjectToolbarProps = {
  study: StudyListItem;
  editing: boolean;
  name: string;
  company: string;
  dataPeriod: string;
  dataSource: string;
  busy: boolean;
  savePending: boolean;
  loadError: string | null;
  onNameChange: (value: string) => void;
  onCompanyChange: (value: string) => void;
  onDataPeriodChange: (value: string) => void;
  onDataSourceChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onSetDefault: () => void;
  onRemove: () => void;
  onUnselect?: () => void;
  displayUnitsDraft?: StudyDisplayUnitsDraft;
};

export function StudyProjectToolbar({
  study,
  editing,
  name,
  company,
  dataPeriod,
  dataSource,
  busy,
  savePending,
  loadError,
  onNameChange,
  onCompanyChange,
  onDataPeriodChange,
  onDataSourceChange,
  onEdit,
  onSave,
  onCancel,
  onSetDefault,
  onRemove,
  onUnselect,
  displayUnitsDraft,
}: StudyProjectToolbarProps) {
  return (
    <div className="study-project-toolbar study-project-toolbar-flat">
      <div className="study-project-toolbar-body">
        {loadError ? <p className="study-project-toolbar-error">{loadError}</p> : null}
        <div className="studies-row-actions-bar">
          {editing ? (
            <div className="study-project-toolbar-edit-fields">
              <label className="study-project-toolbar-field">
                <span className="study-project-toolbar-field-label">Study name</span>
                <input
                  className="studies-inline-input"
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  dir="auto"
                />
              </label>
              <label className="study-project-toolbar-field">
                <span className="study-project-toolbar-field-label">Company</span>
                <input
                  className="studies-inline-input"
                  value={company}
                  onChange={(e) => onCompanyChange(e.target.value)}
                />
              </label>
            </div>
          ) : (
            <span className="studies-row-actions-label" dir="auto">
              {study.name}
            </span>
          )}
        </div>
        <StudyTrustFields
          dataPeriod={dataPeriod}
          dataSource={dataSource}
          onDataPeriodChange={onDataPeriodChange}
          onDataSourceChange={onDataSourceChange}
          editing={editing && !busy}
        />
        {study.status === "ready" ? (
          <div className="study-project-toolbar-section study-project-display-units">
            <p className="studies-display-units-label">Display units</p>
            <StudyDisplayUnitsForm
              slug={study.slug}
              editing={editing && !busy}
              showSaveButton={!displayUnitsDraft}
              draft={displayUnitsDraft}
            />
          </div>
        ) : null}
        <div className="studies-row-actions-buttons study-project-toolbar-actions">
          {editing ? null : (
            <Link
              className="btn-secondary studies-action-btn"
              to={`/studies/${study.slug}/scenarios`}
              onClick={(e) => busy && e.preventDefault()}
            >
              Scenarios
            </Link>
          )}
          {editing ? (
            <>
              <button className="btn-primary studies-action-btn" onClick={onSave} disabled={savePending || busy}>
                Save
              </button>
              <button className="btn-secondary studies-action-btn" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn-primary studies-action-btn" onClick={onEdit} disabled={busy}>
                Edit
              </button>
              {!study.isDefault ? (
                <button className="btn-secondary studies-action-btn" onClick={onSetDefault} disabled={busy}>
                  Set default
                </button>
              ) : null}
              {onUnselect ? (
                <button
                  type="button"
                  className="btn-secondary studies-action-btn"
                  onClick={onUnselect}
                  disabled={busy}
                >
                  Unselect
                </button>
              ) : null}
              <button
                className="btn-secondary studies-action-btn studies-action-danger"
                onClick={onRemove}
                disabled={busy}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
