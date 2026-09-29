import { usePatchStudyMeta } from "../api/hooks";
import {
  useStudyDisplayUnitsDraft,
  type StudyDisplayUnitsDraft,
} from "../hooks/useStudyDisplayUnitsDraft";
import { useSession } from "../stores/sessionStore";
import { StudyUnitFields } from "./StudyUnitFields";

export type StudyDisplayUnitsSaveHandle = StudyDisplayUnitsDraft & {
  saveDisplayUnits: () => Promise<void>;
  isSavingDisplayUnits: boolean;
};

export function useStudyDisplayUnitsSave(slug: string | undefined): StudyDisplayUnitsSaveHandle {
  const draft = useStudyDisplayUnitsDraft(slug);
  const patchMeta = usePatchStudyMeta();
  const { session, setSession } = useSession();

  const saveDisplayUnits = async () => {
    if (!slug) return;
    const { price_currency_symbol, size_unit_label } = draft.getPayload();
    const updated = await patchMeta.mutateAsync({
      slug,
      price_currency_symbol,
      size_unit_label,
    });
    if (session?.slug === slug && session.study) {
      setSession({
        ...session,
        study: {
          ...session.study,
          currencySymbol: updated.price_currency_symbol,
          sizeUnitLabel: updated.size_unit_label,
        },
      });
    }
  };

  return {
    ...draft,
    saveDisplayUnits,
    isSavingDisplayUnits: patchMeta.isPending,
  };
}

export type StudyDisplayUnitsFormProps = {
  slug: string;
  editing?: boolean;
  showSaveButton?: boolean;
  draft?: StudyDisplayUnitsDraft;
};

function StudyDisplayUnitsBody({
  editing,
  draft,
  showSaveButton,
  slug,
}: {
  editing: boolean;
  draft: StudyDisplayUnitsDraft;
  showSaveButton: boolean;
  slug: string;
}) {
  const patchMeta = usePatchStudyMeta();
  const { session, setSession } = useSession();

  const save = () => {
    const { price_currency_symbol, size_unit_label } = draft.getPayload();
    patchMeta.mutate(
      { slug, price_currency_symbol, size_unit_label },
      {
        onSuccess: (updated) => {
          if (session?.slug === slug && session.study) {
            setSession({
              ...session,
              study: {
                ...session.study,
                currencySymbol: updated.price_currency_symbol,
                sizeUnitLabel: updated.size_unit_label,
              },
            });
          }
        },
      },
    );
  };

  if (draft.isError) {
    return <p className="error">Could not load display units.</p>;
  }
  if (draft.isLoading) {
    return <p className="studies-display-units-loading">Loading display units…</p>;
  }

  if (!editing && draft.data) {
    return (
      <div className="study-trust-fields study-trust-fields-readonly study-display-units-readonly">
        <div className="study-trust-info-item">
          <span className="study-trust-field-label">Price currency</span>
          <span className="study-trust-info-value">{draft.data.price_currency_symbol || "—"}</span>
        </div>
        <div className="study-trust-info-item">
          <span className="study-trust-field-label">Size unit</span>
          <span className="study-trust-info-value">{draft.data.size_unit_label || "—"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="studies-display-units-form studies-display-units-form-embedded">
      <StudyUnitFields
        currencySelect={draft.currencySelect}
        currencyCustom={draft.currencyCustom}
        onCurrencySelect={draft.setCurrencySelect}
        onCurrencyCustom={draft.setCurrencyCustom}
        sizeUnitSelect={draft.sizeUnitSelect}
        sizeUnitCustom={draft.sizeUnitCustom}
        onSizeUnitSelect={draft.setSizeUnitSelect}
        onSizeUnitCustom={draft.setSizeUnitCustom}
      />
      {showSaveButton ? (
        <div className="wizard-actions studies-display-units-actions">
          <button type="button" className="btn-primary" disabled={patchMeta.isPending} onClick={save}>
            {patchMeta.isPending ? "Saving…" : "Save display units"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function StudyDisplayUnitsForm({
  slug,
  editing = false,
  showSaveButton = true,
  draft: draftProp,
}: StudyDisplayUnitsFormProps) {
  const internalDraft = useStudyDisplayUnitsDraft(draftProp ? undefined : slug);
  const draft = draftProp ?? internalDraft;

  return (
    <StudyDisplayUnitsBody
      editing={editing}
      draft={draft}
      showSaveButton={showSaveButton}
      slug={slug}
    />
  );
}
