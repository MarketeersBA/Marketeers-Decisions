import { Link } from "react-router-dom";

export function StudyRequiredNotice() {
  return (
    <div className="study-required">
      <div className="study-required-card">
        <h2>No study selected</h2>
        <p>Return to Data Hub and choose a study before using this page.</p>
        <Link className="btn-primary study-required-link" to="/data-hub">
          Go to Data Hub
        </Link>
      </div>
    </div>
  );
}
