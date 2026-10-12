import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCreateStudy, useLoadSession, useUploadDesign, useUploadHbu } from "../api/hooks";
import {
  CURRENCY_PRESETS,
  DEFAULT_CURRENCY_SYMBOL,
  DEFAULT_SIZE_UNIT_LABEL,
  SIZE_UNIT_PRESETS,
  resolveUnitField,
  unitSelectState,
} from "../lib/studyDisplay";
import { DEFAULT_DATA_SOURCE, defaultDataPeriod } from "../lib/studyTrustOptions";
import { useSession } from "../stores/sessionStore";
import { StudyTrustFields } from "./StudyTrustFields";
import { StudyUnitFields } from "./StudyUnitFields";

interface ParseMeta {
  study_name: string;
  study_description: string;
  company_name: string;
  company_location: string;
  category: string;
  msu: number;
  su: number;
  vsu: number;
  exponent_factor: number;
  price_currency_symbol?: string;
  size_unit_label?: string;
}

function formatLevelNames(names: string[] | undefined): string {
  if (!names?.length) return "";
  return names
    .map((name) => {
      if (!/^-?\d+\.\d+$/.test(name)) return name;
      const num = Number(name);
      if (!Number.isFinite(num)) return name;
      const rounded = Number(num.toFixed(12));
      return String(rounded);
    })
    .join(", ");
}

type StudyUploadWizardProps = {
  onCancel?: () => void;
  embedded?: boolean;
};

export function StudyUploadWizard({ onCancel, embedded = false }: StudyUploadWizardProps) {
  const navigate = useNavigate();
  const { setSession } = useSession();
  const [step, setStep] = useState(0);

  const uploadDesignMutation = useUploadDesign();
  const uploadHbuMutation = useUploadHbu();
  const createStudyMutation = useCreateStudy();
  const loadSessionMutation = useLoadSession();

  const [wizardId, setWizardId] = useState<string | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [meta, setMeta] = useState<ParseMeta | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [attributes, setAttributes] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [segments, setSegments] = useState<any[]>([]);
  const [hbuSummary, setHbuSummary] = useState<{ respondent_count: number; columns: string[] } | null>(null);

  const [designFile, setDesignFile] = useState<File | null>(null);
  const [hbuFile, setHbuFile] = useState<File | null>(null);

  const [studyName, setStudyName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [category, setCategory] = useState("");
  const [market, setMarket] = useState("");
  const [exponentFactor, setExponentFactor] = useState(1.0);
  const [msu, setMsu] = useState(1.0);
  const [su, setSu] = useState(1.0);
  const [vsu, setVsu] = useState(0.0);

  const [currencySelect, setCurrencySelect] = useState(DEFAULT_CURRENCY_SYMBOL);
  const [currencyCustom, setCurrencyCustom] = useState("");
  const [sizeUnitSelect, setSizeUnitSelect] = useState(DEFAULT_SIZE_UNIT_LABEL);
  const [sizeUnitCustom, setSizeUnitCustom] = useState("");
  const [dataPeriod, setDataPeriod] = useState(defaultDataPeriod);
  const [dataSource, setDataSource] = useState<string>(DEFAULT_DATA_SOURCE);

  const [activeTable, setActiveTable] = useState<"products" | "attributes" | "groups" | "segments" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const designInputRef = useRef<HTMLInputElement>(null);
  const hbuInputRef = useRef<HTMLInputElement>(null);

  const handleDesignFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setDesignFile(e.target.files[0]);
      setErrorMsg(null);
    }
  };

  const handleHbuFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setHbuFile(e.target.files[0]);
      setErrorMsg(null);
    }
  };

  const handleParseDesign = async () => {
    if (!designFile) return;
    setErrorMsg(null);
    try {
      const res = await uploadDesignMutation.mutateAsync(designFile);
      setWizardId(res.wizard_id);
      setMeta(res.meta);
      setProducts(res.products);
      setAttributes(res.attributes);
      setGroups(res.groups);
      setSegments(res.segments);
      setStudyName(res.meta.study_name || "");
      setCompanyName(res.meta.company_name || "");
      setCategory(res.meta.category || "");
      setMarket(res.meta.company_location || "");
      setExponentFactor(res.meta.exponent_factor ?? 1.0);
      setMsu(res.meta.msu ?? 1.0);
      setSu(res.meta.su ?? 1.0);
      setVsu(res.meta.vsu ?? 0.0);
      const cur = unitSelectState(
        res.meta.price_currency_symbol,
        CURRENCY_PRESETS,
        DEFAULT_CURRENCY_SYMBOL,
      );
      setCurrencySelect(cur.select);
      setCurrencyCustom(cur.custom);
      const size = unitSelectState(
        res.meta.size_unit_label,
        SIZE_UNIT_PRESETS,
        DEFAULT_SIZE_UNIT_LABEL,
      );
      setSizeUnitSelect(size.select);
      setSizeUnitCustom(size.custom);
      setStep(1);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to parse design sheet.");
    }
  };

  const handleParseHbu = async () => {
    if (!hbuFile || !wizardId) return;
    setErrorMsg(null);
    try {
      const res = await uploadHbuMutation.mutateAsync({ wizardId, file: hbuFile });
      setHbuSummary(res);
      setStep(2);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to parse HBU utilities.");
    }
  };

  const handleCreateStudy = async () => {
    if (!wizardId || !studyName.trim()) return;
    setErrorMsg(null);
    try {
      const price_currency_symbol = resolveUnitField(
        currencySelect,
        currencyCustom,
        CURRENCY_PRESETS,
        DEFAULT_CURRENCY_SYMBOL,
      );
      const size_unit_label = resolveUnitField(
        sizeUnitSelect,
        sizeUnitCustom,
        SIZE_UNIT_PRESETS,
        DEFAULT_SIZE_UNIT_LABEL,
      );
      const res = await createStudyMutation.mutateAsync({
        wizard_id: wizardId,
        name: studyName,
        company: companyName,
        category,
        market,
        exponent_factor: exponentFactor,
        msu,
        su,
        vsu,
        price_currency_symbol,
        size_unit_label,
        design_source_filename: designFile?.name ?? "",
        hbu_source_filename: hbuFile?.name ?? "",
        data_period: dataPeriod,
        data_source: dataSource,
      });
      setCreatedSlug(res.slug);
      setStep(3);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to finalize study.");
    }
  };

  const handleOpenStudy = async (slug: string) => {
    setErrorMsg(null);
    try {
      const payload = await loadSessionMutation.mutateAsync(slug);
      setSession(payload);
      navigate("/optimizer");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to load study.");
    }
  };

  const resetWizard = () => {
    setStep(0);
    setWizardId(null);
    setCreatedSlug(null);
    setMeta(null);
    setProducts([]);
    setAttributes([]);
    setGroups([]);
    setSegments([]);
    setHbuSummary(null);
    setDesignFile(null);
    setHbuFile(null);
    setDataPeriod(defaultDataPeriod());
    setDataSource(DEFAULT_DATA_SOURCE);
    setErrorMsg(null);
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
      return;
    }
    if (embedded) {
      resetWizard();
      return;
    }
    navigate("/data-hub");
  };

  const steps = [
    { label: "Design Excel", description: "Upload study design structure" },
    { label: "HBU File", description: "Upload respondent utility matrix" },
    { label: "Review", description: "Verify dimensions & metadata" },
    { label: "Create", description: "Successfully register study" },
  ];

  return (
    <div className={embedded ? "study-upload-wizard" : "wizard-page-container"}>
      {!embedded ? (
        <div className="page-header">
          <h1 className="page-title">Upload Study</h1>
          <p className="page-subtitle">Configure and ingest a new study from design and HBU workbooks.</p>
        </div>
      ) : null}

      <div className="stepper-rail">
        {steps.map((s, idx) => {
          let stateClass = "inactive";
          if (step === idx) stateClass = "active";
          else if (step > idx) stateClass = "completed";

          return (
            <div key={idx} className={`step-item ${stateClass}`}>
              <div className="step-badge">
                {stateClass === "completed" ? "✓" : idx + 1}
              </div>
              <div className="step-text">
                <span className="step-label">{s.label}</span>
                <span className="step-desc">{s.description}</span>
              </div>
              {idx < steps.length - 1 && <div className="step-line" />}
            </div>
          );
        })}
      </div>

      {errorMsg && (
        <div className="banner-error mb-16" role="alert">
          <div className="error-title">Import Error</div>
          <div>{errorMsg}</div>
        </div>
      )}

      {step === 0 && (
        <div className="wizard-step-panel">
          <h2>Step 1: Upload Design Sheet</h2>
          <p className="section-instruction">
            Upload the study configuration workbook. This file must contain the <strong>Description</strong>, <strong>Attributes</strong>, <strong>Product List</strong> sheets, and optionally <strong>Groups</strong> and <strong>Segments</strong>.
          </p>

          <div
            className={`drag-drop-zone ${designFile ? "has-file" : ""}`}
            onClick={() => designInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                setDesignFile(e.dataTransfer.files[0]);
                setErrorMsg(null);
              }
            }}
          >
            <input
              type="file"
              accept=".xlsx,.xls"
              ref={designInputRef}
              onChange={handleDesignFileChange}
              style={{ display: "none" }}
            />
            <div className="drag-drop-icon">📂</div>
            {designFile ? (
              <div className="file-info">
                <span className="file-name">{designFile.name}</span>
                <span className="file-size">({(designFile.size / 1024).toFixed(1)} KB)</span>
              </div>
            ) : (
              <div>Drag & drop study design Excel here, or <span>browse files</span></div>
            )}
          </div>

          <div className={`wizard-actions${embedded && step === 0 ? " wizard-actions-single" : ""}`}>
            {!(embedded && step === 0) ? (
              <button type="button" className="btn-secondary" onClick={handleCancel}>
                {embedded ? "Reset" : "Cancel"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-primary"
              disabled={!designFile || uploadDesignMutation.isPending}
              onClick={handleParseDesign}
            >
              {uploadDesignMutation.isPending ? "Parsing..." : "Parse Design Sheet →"}
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="wizard-step-panel">
          <h2>Step 2: Upload HBU Utilities</h2>
          <div className="banner-success mb-16">
            Design loaded: <strong>{meta?.study_name || "Unnamed Study"}</strong> &middot; {products.length} products &middot; {attributes.length} attributes &middot; {groups.length} groups
          </div>

          <p className="section-instruction">
            Upload the utilities workbook containing individual respondent utilities. Columns must correspond to attributes and levels described in the design file.
          </p>

          <div
            className={`drag-drop-zone ${hbuFile ? "has-file" : ""}`}
            onClick={() => hbuInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                setHbuFile(e.dataTransfer.files[0]);
                setErrorMsg(null);
              }
            }}
          >
            <input
              type="file"
              accept=".xlsx,.xls"
              ref={hbuInputRef}
              onChange={handleHbuFileChange}
              style={{ display: "none" }}
            />
            <div className="drag-drop-icon">📊</div>
            {hbuFile ? (
              <div className="file-info">
                <span className="file-name">{hbuFile.name}</span>
                <span className="file-size">({(hbuFile.size / 1024).toFixed(1)} KB)</span>
              </div>
            ) : (
              <div>Drag & drop HBU Excel here, or <span>browse files</span></div>
            )}
          </div>

          <div className="wizard-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep(0)}>← Back</button>
            <button
              type="button"
              className="btn-primary"
              disabled={!hbuFile || uploadHbuMutation.isPending}
              onClick={handleParseHbu}
            >
              {uploadHbuMutation.isPending ? "Parsing..." : "Parse HBU File →"}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-step-panel">
          <h2>Step 3: Review and Configure Metadata</h2>

          <div className="review-columns">
            <div className="review-card form-panel">
              <h3>Study Metadata</h3>
              <div className="form-group">
                <label>Study Name</label>
                <input
                  type="text"
                  value={studyName}
                  onChange={(e) => setStudyName(e.target.value)}
                  placeholder="e.g. Arabica Coffee Ingestion"
                />
              </div>

              <div className="form-group">
                <label>Company / Client</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Roastmasters Corp"
                />
              </div>

              <StudyTrustFields
                className="study-trust-fields-wizard"
                dataPeriod={dataPeriod}
                dataSource={dataSource}
                onDataPeriodChange={setDataPeriod}
                onDataSourceChange={setDataSource}
              />

              <div className="form-group">
                <label>Category</label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Beer, off-trade"
                />
              </div>

              <div className="form-group">
                <label>Market</label>
                <input
                  type="text"
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                  placeholder="e.g. Portugal"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Exponent Factor (Scale)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={exponentFactor}
                    onChange={(e) => setExponentFactor(parseFloat(e.target.value) || 1)}
                  />
                </div>
                <div className="form-group">
                  <label>MSU (Market Size Unit)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={msu}
                    onChange={(e) => setMsu(parseFloat(e.target.value) || 1)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>SU (Sales Units)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={su}
                    onChange={(e) => setSu(parseFloat(e.target.value) || 1)}
                  />
                </div>
                <div className="form-group">
                  <label>VSU (Value Sales Unit)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={vsu}
                    onChange={(e) => setVsu(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              <StudyUnitFields
                currencySelect={currencySelect}
                currencyCustom={currencyCustom}
                onCurrencySelect={setCurrencySelect}
                onCurrencyCustom={setCurrencyCustom}
                sizeUnitSelect={sizeUnitSelect}
                sizeUnitCustom={sizeUnitCustom}
                onSizeUnitSelect={setSizeUnitSelect}
                onSizeUnitCustom={setSizeUnitCustom}
              />
            </div>

            <div className="review-card count-panel">
              <h3>Ingestion Summary</h3>
              <div className="count-grid">
                <div className="count-stat-card">
                  <span className="stat-num">{products.length}</span>
                  <span className="stat-lbl">Products</span>
                </div>
                <div className="count-stat-card">
                  <span className="stat-num">{attributes.length}</span>
                  <span className="stat-lbl">Attributes</span>
                </div>
                <div className="count-stat-card">
                  <span className="stat-num">{hbuSummary?.respondent_count || 0}</span>
                  <span className="stat-lbl">Respondents</span>
                </div>
                <div className="count-stat-card">
                  <span className="stat-num">{groups.length}</span>
                  <span className="stat-lbl">Groups</span>
                </div>
                <div className="count-stat-card text-center full-width">
                  <span className="stat-lbl">Segmentation Dimensions: <strong>{segments.length}</strong></span>
                </div>
              </div>

              {groups.length === 0 && (
                <div className="notice-warn">
                  ⚠️ <strong>Groups not detected.</strong> You will not be able to rollup shares by brand. You can configure group sheets in your design template and re-import.
                </div>
              )}
            </div>
          </div>

          <div className="wizard-actions mt-16">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>← Back</button>
            <button
              type="button"
              className="btn-primary"
              disabled={!studyName.trim() || createStudyMutation.isPending}
              onClick={handleCreateStudy}
            >
              {createStudyMutation.isPending ? "Creating study…" : "Create Study →"}
            </button>
          </div>

          <div className="collapsible-section mt-16">
            <div className="section-tabs">
              <button
                type="button"
                className={`tab-btn ${activeTable === "products" ? "active" : ""}`}
                onClick={() => setActiveTable(activeTable === "products" ? null : "products")}
              >
                Products ({products.length}) {activeTable === "products" ? "▲" : "▼"}
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTable === "attributes" ? "active" : ""}`}
                onClick={() => setActiveTable(activeTable === "attributes" ? null : "attributes")}
              >
                Attributes ({attributes.length}) {activeTable === "attributes" ? "▲" : "▼"}
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTable === "groups" ? "active" : ""}`}
                onClick={() => setActiveTable(activeTable === "groups" ? null : "groups")}
              >
                Groups ({groups.length}) {activeTable === "groups" ? "▲" : "▼"}
              </button>
            </div>

            {activeTable === "products" && (
              <div className="table-wrap">
                <table className="wizard-preview-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Product Name</th>
                      <th>Company</th>
                      <th>Base WD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, idx) => (
                      <tr key={idx}>
                        <td>{p.product_id}</td>
                        <td>{p.name}</td>
                        <td>{p.company || "-"}</td>
                        <td>{(p.base_wd * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTable === "attributes" && (
              <div className="table-wrap">
                <table className="wizard-preview-table">
                  <thead>
                    <tr>
                      <th>Attribute Name</th>
                      <th>Type</th>
                      <th>Levels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attributes.map((a, idx) => (
                      <tr key={idx}>
                        <td><strong>{a.name}</strong></td>
                        <td>{a.attr_type}</td>
                        <td>{formatLevelNames(a.level_names) || `${a.level_count} levels`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTable === "groups" && (
              <div className="table-wrap">
                {groups.length === 0 ? (
                  <p className="no-data">No groups parsed.</p>
                ) : (
                  <table className="wizard-preview-table">
                    <thead>
                      <tr>
                        <th>Group Type</th>
                        <th>Group Name</th>
                        <th>Mapped Products</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g, idx) => (
                        <tr key={idx}>
                          <td>{g.group_type}</td>
                          <td><strong>{g.group_name}</strong></td>
                          <td>{g.product_names?.join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="wizard-step-panel success-panel">
          <div className="success-icon" aria-hidden="true">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="26" stroke="currentColor" strokeWidth="2" />
              <path
                d="M17 29.2 24.2 36.5 39 20.5"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h2>Study Created Successfully!</h2>
          <p className="success-description">
            Study <strong>{studyName}</strong> has been parsed, calibrated, and registered in the simulation index.
          </p>

          <div className="success-cta-box">
            <button type="button" className="btn-secondary btn-large" onClick={resetWizard}>
              Create Another Study
            </button>
            <button
              type="button"
              className="btn-primary btn-large"
              disabled={loadSessionMutation.isPending}
              onClick={() => createdSlug && handleOpenStudy(createdSlug)}
            >
              {loadSessionMutation.isPending ? "Opening..." : "Open in Price Simulation ➔"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
