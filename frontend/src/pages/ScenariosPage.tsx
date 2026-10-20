import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  useDeleteScenario,
  useImportScenarios,
  usePreviewScenarioImport,
  useReorderScenarios,
  useScenarios,
  useSeedBaseScenario,
  useStudies,
} from "../api/hooks";
import type { ScenarioImportPreview } from "../api/types";
import "./pages.css";

export function ScenariosPage() {
  const { slug = "" } = useParams();
  const { data: studies } = useStudies();
  const study = studies?.find((s) => s.slug === slug);
  const {
    data: scenarios = [],
    isLoading,
    isError,
    error,
  } = useScenarios(slug);
  const reorder = useReorderScenarios(slug);
  const deleteScenario = useDeleteScenario(slug);
  const seedBase = useSeedBaseScenario(slug);
  const previewImport = usePreviewScenarioImport(slug);
  const importScenarios = useImportScenarios(slug);

  const [order, setOrder] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [previews, setPreviews] = useState<ScenarioImportPreview[]>([]);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    setOrder([]);
    setImportError("");
    setFile(null);
    setPreviews([]);
  }, [slug]);

  const names = useMemo(() => {
    const scenarioNames = scenarios.map((s) => s.name);
    if (order.length === 0) return scenarioNames;
    if (order.length !== scenarioNames.length) return scenarioNames;
    const nameSet = new Set(scenarioNames);
    if (order.every((n) => nameSet.has(n))) return order;
    return scenarioNames;
  }, [scenarios, order]);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...names];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    reorder.mutate(next);
  };

  const onPickFile = (f: File | null) => {
    setFile(f);
    setPreviews([]);
    setImportError("");
    if (!f) return;
    previewImport.mutate(f, {
      onSuccess: (data) => setPreviews(data.previews),
      onError: (err) => setImportError((err as Error).message),
    });
  };

  const runImport = () => {
    if (!file) return;
    const validNames = previews.filter((p) => p.valid).map((p) => p.name);
    importScenarios.mutate(
      { file, names: validNames },
      {
        onSuccess: () => {
          setFile(null);
          setPreviews([]);
          setImportError("");
        },
        onError: (err) => setImportError((err as Error).message),
      },
    );
  };

  if (!slug) return <div className="panel error">Missing study slug.</div>;
  if (isLoading) return <div className="panel">Loading scenarios…</div>;
  if (isError) {
    return (
      <div className="panel error">
        Failed to load scenarios for study <code>{slug}</code>: {(error as Error).message}
      </div>
    );
  }

  const studyLabel = study?.name ?? slug;

  return (
    <div className="scenarios-page">
      <header className="scenarios-page-header">
        <div className="scenarios-page-header-main">
          <h1 className="page-title scenarios-page-title">Scenario Library</h1>
          <p className="hint scenarios-page-meta">
            {studyLabel} · <code>{slug}</code> · {scenarios.length} saved scenario
            {scenarios.length === 1 ? "" : "s"}. Reorder or delete below; import from Excel at the
            bottom.
          </p>
        </div>
        <Link className="scenarios-page-back" to="/runner">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 3.5 5.5 8 10 12.5"
            />
          </svg>
          Back to Simulation
        </Link>
      </header>

      <div className="studies-panel">
        <div className="studies-table-wrap">
          <table className="scenarios-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Name</th>
                <th>Description</th>
                <th>V</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {names.length === 0 ? (
                <tr>
                  <td colSpan={5} className="scenarios-empty-cell">
                    <p className="scenarios-empty-title">No saved scenarios for this study</p>
                    <p className="hint scenarios-empty-hint">
                      Each study keeps its own scenario list on the server. Save from Price Simulation or
                      create a base snapshot to get started.
                    </p>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={seedBase.isPending}
                      onClick={() => seedBase.mutate()}
                    >
                      Create base scenario from study defaults
                    </button>
                  </td>
                </tr>
              ) : (
                names.map((name, i) => {
                  const s = scenarios.find((x) => x.name === name);
                  return (
                    <tr key={name}>
                      <td>
                        <button className="btn-secondary btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>
                          ↑
                        </button>
                        <button
                          className="btn-secondary btn-sm"
                          style={{ marginLeft: 4 }}
                          onClick={() => move(i, 1)}
                          disabled={i === names.length - 1}
                        >
                          ↓
                        </button>
                      </td>
                      <td>{name}</td>
                      <td>{s?.description ?? ""}</td>
                      <td>{s?.validation ? "V" : ""}</td>
                      <td>
                        <button
                          className="btn-secondary btn-sm"
                          style={{ color: "var(--danger)" }}
                          onClick={() => deleteScenario.mutate(name)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="scenarios-import" aria-labelledby="scenarios-import-title">
        <h2 id="scenarios-import-title" className="scenarios-import-title">
          Import from Excel
        </h2>
        <p className="hint scenarios-import-note">
          One scenario per sheet. Each sheet needs a Product Name column and New * attribute columns.
        </p>
        <div className="scenarios-import-row">
          <label className="scenarios-file-btn">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            Choose file
          </label>
          <span className="scenarios-file-name">{file ? file.name : "No file chosen"}</span>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!file || previews.every((p) => !p.valid) || importScenarios.isPending}
            onClick={runImport}
          >
            Import valid scenarios
          </button>
        </div>
        {importError ? <p className="scenarios-import-error">{importError}</p> : null}
        {previews.length > 0 ? (
          <table className="scenarios-table scenarios-import-preview">
            <thead>
              <tr>
                <th>Sheet</th>
                <th>Products</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {previews.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{p.productCount}</td>
                  <td>{p.valid ? "Ready" : p.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
