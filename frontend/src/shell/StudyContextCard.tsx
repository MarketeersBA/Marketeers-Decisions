import { useSession } from "../stores/sessionStore";

// Shell study-context card — UX_UI_SPEC.md section 4.4.
export function StudyContextCard() {
  const { session } = useSession();
  if (!session) return null;
  const s = session.study;
  return (
    <div className="study-card">
      <div className="study-card-name" dir="auto">
        {s.studyName}
      </div>
      <div className="study-card-line">{s.companyName}</div>
      <div className="study-card-line">{s.products} products</div>
      <div className="study-card-line">{s.respondents} respondents</div>
      {s.activeSegment ? <div className="segment-badge">Segment: {s.activeSegment}</div> : null}
      {session.scenarioName ? (
        <div className="scenario-line">Scenario: {session.scenarioName}</div>
      ) : null}
    </div>
  );
}
