import { useState } from "react";

import { DataSourcesSection } from "../components/DataSourcesSection";
import { ModelValidationPanel } from "../components/ModelValidationPanel";
import { StudyProjectPanel } from "../components/StudyProjectPanel";
import { StudyManager } from "../components/StudyManager";
import { StudyUploadWizard } from "../components/StudyUploadWizard";
import { useSession } from "../stores/sessionStore";
import "./pages.css";

export function DataHubPage() {
  const { session, setSession } = useSession();

  const handleStudyDeleted = (slug: string) => {
    if (session?.slug === slug) {
      setSession(null);
    }
  };
  const workspaceMode = session !== null;
  const [studiesExpanded, setStudiesExpanded] = useState(false);

  return (
    <div className="data-hub-page">
      <h1 className="page-title">Data Hub &amp; Trust</h1>
      {workspaceMode ? (
        <p className="page-sub">
          Manage the active project below, review data sources, or expand change project to pick
          another study or upload a new one.
        </p>
      ) : (
        <p className="page-sub">
          Manage existing studies, then upload new design and HBU workbooks when you need to add
          data. Every simulation above is only as good as the data behind it.
        </p>
      )}

      {workspaceMode ? (
        <>
          <section className="data-hub-section data-hub-project-row">
            <DataSourcesSection slug={session.slug} />
            <StudyProjectPanel slug={session.slug} onStudyDeleted={handleStudyDeleted} />
          </section>
          <div className="data-hub-section">
            <ModelValidationPanel slug={session.slug} />
          </div>

          <section className="data-hub-section data-hub-change-project">
            <button
              type="button"
              className="data-hub-change-project-toggle"
              aria-expanded={studiesExpanded}
              onClick={() => setStudiesExpanded((open) => !open)}
            >
              <span className="data-hub-change-project-label">Change project</span>
              <span className="data-hub-change-project-current" dir="auto">
                {session.study.studyName}
              </span>
              <span className={`model-validation-caret${studiesExpanded ? " is-open" : ""}`} aria-hidden>
                <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                  <path
                    d="M4.5 7.25 9 11.75 13.5 7.25"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
            {studiesExpanded ? (
              <div className="data-hub-change-project-panel">
                <StudyManager
                  activeSlug={session.slug}
                  showToolbar={false}
                  navigateOnOpen={false}
                  onOpenSuccess={() => setStudiesExpanded(false)}
                  onStudyDeleted={handleStudyDeleted}
                />
                <section className="data-hub-section data-hub-upload-in-panel" id="upload-study">
                  <h2 className="data-hub-section-title">Upload study</h2>
                  <p className="data-hub-section-sub">
                    Configure and ingest a new study from design and HBU workbooks.
                  </p>
                  <StudyUploadWizard embedded />
                </section>
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <section className="data-hub-section" id="manage-studies">
          <h2 className="data-hub-section-title">Manage studies</h2>
          <p className="data-hub-section-sub">
            Click a study row to open it. Use the project toolbar for edit, scenarios, display
            units, or delete.
          </p>
          <StudyManager navigateOnOpen={false} onStudyDeleted={handleStudyDeleted} />
        </section>
      )}

      {!workspaceMode ? (
        <section className="data-hub-section" id="upload-study">
          <h2 className="data-hub-section-title">Upload study</h2>
          <p className="data-hub-section-sub">
            Configure and ingest a new study from design and HBU workbooks.
          </p>
          <StudyUploadWizard embedded />
        </section>
      ) : null}
    </div>
  );
}
