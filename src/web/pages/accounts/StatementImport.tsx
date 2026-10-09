import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyProfile,
  balancingDeposits,
  buildStatementTransactions,
  decodeStatement,
  DEFAULT_STATEMENT_OPTIONS,
  detectStatementTable,
  getSettings,
  importImpact,
  parseStatementRows,
  pickProfile,
  profileFromImport,
  repairHeaderTypo,
  suggestMapping,
  tableToTsv,
  validateMapping,
  wordsToTable,
  type BalancingMode,
  type Delimiter,
  type Instrument,
  type MappingSuggestion,
  type StatementEncoding,
  type StatementField,
  type StatementMapping,
  type StatementOptions,
} from '@core/index';
import { Modal } from '../../components/ui';
import { isImageFile, recognizeImage, type OcrProgress } from '../../ocr';
import { setTable, upsertRow, useData, useStore } from '../../store';
import FileStep from './statement/FileStep';
import ImpactStep from './statement/ImpactStep';
import MappingStep, { type WizardOptions } from './statement/MappingStep';
import ReviewStep from './statement/ReviewStep';
import './statement/statementImport.css';

const STEPS = ['選擇檔案', '欄位對應', '逐列檢查', '影響預覽', '完成'] as const;

interface Source {
  fileName: string;
  /** File bytes, kept so the text can be re-decoded with another encoding. */
  bytes?: Uint8Array;
  /** Screenshot: preview URL, recognised text and how many cells were uncertain. */
  image?: { url: string; text: string; uncertain: number };
}

/**
 * Import a broker or exchange statement — a CSV export or a screenshot —
 * as transactions. Nothing is written until the last step is confirmed.
 */
export default function StatementImport(props: { onClose: () => void }) {
  const data = useData();
  const store = useStore();
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<Source>();
  const [error, setError] = useState('');
  const [ocr, setOcr] = useState<OcrProgress>();
  const [accountId, setAccountId] = useState(data.accounts.find((a) => a.active)?.id ?? '');
  const [bucket, setBucket] = useState('core');
  const [encoding, setEncoding] = useState<StatementEncoding>();
  const [delimiter, setDelimiter] = useState<Delimiter>();
  const [headerRow, setHeaderRow] = useState<number>();
  const [mapping, setMapping] = useState<StatementMapping>({});
  const [confidence, setConfidence] = useState<MappingSuggestion['confidence']>({});
  const account = data.accounts.find((a) => a.id === accountId);
  const [options, setOptions] = useState<WizardOptions>({
    dateOrder: DEFAULT_STATEMENT_OPTIONS.dateOrder,
    roc: DEFAULT_STATEMENT_OPTIONS.roc,
    quantityUnit: DEFAULT_STATEMENT_OPTIONS.quantityUnit,
    lotSize: DEFAULT_STATEMENT_OPTIONS.lotSize ?? 1000,
    estimateMissingFees: false,
    defaultCurrency: account?.baseCurrency ?? getSettings(data).baseCurrency,
  });
  const [profileId, setProfileId] = useState('');
  const [profileScore, setProfileScore] = useState<number>();
  const [saveProfile, setSaveProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Instrument>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<BalancingMode>('none');
  const [summary, setSummary] = useState('');

  // The preview URL of a screenshot is released when it is replaced or the wizard closes.
  const imageUrl = source?.image?.url;
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);

  const decoded = useMemo(() => {
    if (source?.image)
      return { text: source.image.text, encoding: 'utf-8' as const, detected: true };
    return source?.bytes ? decodeStatement(source.bytes, { encoding }) : undefined;
  }, [source, encoding]);

  const table = useMemo(
    () =>
      decoded
        ? detectStatementTable(decoded.text, {
            // Recognised screenshots are always laid out with tabs.
            delimiter: source?.image ? '\t' : delimiter,
            headerRow,
          })
        : undefined,
    [decoded, delimiter, headerRow, source?.image],
  );

  // A new header row means a new layout: suggest the mapping again, or
  // reuse a saved profile whose headers look the same.
  const headerKey = table?.headers.join('\u0001') ?? '';
  useEffect(() => {
    if (!table) return;
    const match = pickProfile(table.headers, data.importProfiles);
    if (match) {
      const applied = applyProfile(match.profile, table.headers);
      setMapping(applied.mapping);
      setConfidence({});
      setOptions((o) => ({ ...o, ...pickWizardOptions(applied.options) }));
      setProfileId(match.profile.id);
      setProfileScore(match.score);
    } else {
      const suggestion = suggestMapping(table.headers);
      setMapping(suggestion.mapping);
      setConfidence(suggestion.confidence);
      setProfileId('');
      setProfileScore(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerKey]);

  const onFile = useCallback(async (file: File) => {
    setError('');
    setHeaderRow(undefined);
    setDelimiter(undefined);
    setEncoding(undefined);
    try {
      if (isImageFile(file)) {
        setSource(undefined);
        setOcr({ status: '準備中', progress: 0 });
        const words = await recognizeImage(file, setOcr);
        const recognised = wordsToTable(words);
        if (!recognised.rows.length) throw new Error('這張圖片中辨識不到文字');
        setSource({
          fileName: file.name,
          image: {
            url: URL.createObjectURL(file),
            // Header cells one character off a known header are mended;
            // everything else is left for the user to check.
            text: tableToTsv(recognised.rows.map((row) => row.map(repairHeaderTypo))),
            uncertain: recognised.uncertain.length,
          },
        });
      } else {
        setSource({ fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      }
    } catch (err) {
      setError(`無法讀取檔案：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOcr(undefined);
    }
  }, []);

  const fullOptions: StatementOptions = useMemo(
    () => ({
      ...options,
      accountId,
      bucket,
      instrumentChoices: choices,
      confirmedInstruments: Object.fromEntries(
        Object.entries(drafts).filter(([key]) => confirmed[key]),
      ),
    }),
    [options, accountId, bucket, choices, drafts, confirmed],
  );

  const rows = useMemo(
    () => (table && step >= 2 ? parseStatementRows(table, mapping, options) : []),
    [table, mapping, options, step],
  );
  const build = useMemo(
    () => (step >= 2 ? buildStatementTransactions(rows, mapping, fullOptions, data) : undefined),
    [rows, mapping, fullOptions, data, step],
  );
  const deposits = useMemo(
    () => (build && step >= 3 ? balancingDeposits(data, build.transactions, mode) : []),
    [build, data, mode, step],
  );
  const impact = useMemo(
    () =>
      build && step >= 3 ? importImpact(data, [...deposits, ...build.transactions]) : undefined,
    [build, deposits, data, step],
  );

  const mappingProblems = validateMapping(mapping);
  const canNext =
    (step === 0 && Boolean(table?.rows.length) && Boolean(accountId) && !ocr) ||
    (step === 1 && mappingProblems.length === 0) ||
    (step === 2 && Boolean(build?.transactions.length)) ||
    step === 3;

  const commit = () => {
    if (!build || !table) return;
    const newInstruments = build.newInstruments
      .filter((n) => n.confirmed)
      .map((n) => drafts[n.key] ?? n.instrument);
    if (newInstruments.length) setTable('instruments', [...data.instruments, ...newInstruments]);
    setTable('transactions', [...data.transactions, ...deposits, ...build.transactions]);
    if (saveProfile && profileName.trim()) {
      upsertRow(
        'importProfiles',
        profileFromImport(profileName.trim(), table.headers, mapping, options, {
          brokerId: account?.brokerId,
        }),
      );
    }
    setSummary(
      `已匯入 ${build.transactions.length} 筆交易` +
        (deposits.length ? `、${deposits.length} 筆開帳入金` : '') +
        (newInstruments.length ? `，新增 ${newInstruments.length} 個商品` : '') +
        `；略過重複 ${build.duplicates} 筆、錯誤 ${build.errors.length} 筆。`,
    );
    setStep(4);
  };

  return (
    <Modal
      title="匯入券商對帳單"
      wide
      onClose={props.onClose}
      footer={
        step === 4 ? (
          <button className="primary" onClick={props.onClose}>
            完成
          </button>
        ) : (
          <>
            <button className="ghost" onClick={props.onClose}>
              取消
            </button>
            {step > 0 && <button onClick={() => setStep(step - 1)}>上一步</button>}
            {step < 3 ? (
              <button className="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
                下一步
              </button>
            ) : (
              <button className="primary" disabled={!build?.transactions.length} onClick={commit}>
                確認匯入 {build?.transactions.length ?? 0} 筆
              </button>
            )}
          </>
        )
      }
    >
      <ol className="si-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'active' : i < step ? 'done' : ''}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {store.demo && (
        <div className="notice warn">預覽模式：可以完整試用匯入流程，但結果不會儲存。</div>
      )}

      {step === 0 && (
        <FileStep
          fileName={source?.fileName}
          decoded={decoded}
          table={table}
          error={error}
          image={source?.image}
          ocr={ocr}
          accounts={data.accounts}
          brokers={data.brokers}
          strategies={data.strategies}
          accountId={accountId}
          bucket={bucket}
          encoding={encoding}
          delimiter={delimiter}
          headerRow={headerRow}
          onFile={(file) => void onFile(file)}
          onImageText={(text) =>
            setSource((s) => (s?.image ? { ...s, image: { ...s.image, text } } : s))
          }
          onAccount={(id) => {
            setAccountId(id);
            const currency = data.accounts.find((a) => a.id === id)?.baseCurrency;
            if (currency) setOptions((o) => ({ ...o, defaultCurrency: currency }));
          }}
          onBucket={setBucket}
          onEncoding={setEncoding}
          onDelimiter={setDelimiter}
          onHeaderRow={setHeaderRow}
        />
      )}
      {step === 0 && data.accounts.length === 0 && (
        <div className="notice warn">還沒有任何帳戶：請先到「帳戶與機構」新增機構與帳戶。</div>
      )}

      {step === 1 && table && (
        <MappingStep
          table={table}
          mapping={mapping}
          confidence={confidence}
          options={options}
          profiles={data.importProfiles}
          profileId={profileId}
          profileScore={profileScore}
          saveProfile={saveProfile}
          profileName={profileName}
          onMapping={(field: StatementField, header: string) =>
            setMapping((m) => {
              const next = { ...m };
              if (header) next[field] = header;
              else delete next[field];
              return next;
            })
          }
          onOptions={(patch) => setOptions((o) => ({ ...o, ...patch }))}
          onProfile={(id) => {
            setProfileId(id);
            setProfileScore(undefined);
            const profile = data.importProfiles.find((p) => p.id === id);
            if (!profile) {
              const suggestion = suggestMapping(table.headers);
              setMapping(suggestion.mapping);
              setConfidence(suggestion.confidence);
              return;
            }
            const applied = applyProfile(profile, table.headers);
            setMapping(applied.mapping);
            setConfidence({});
            setOptions((o) => ({ ...o, ...pickWizardOptions(applied.options) }));
          }}
          onSaveProfile={setSaveProfile}
          onProfileName={setProfileName}
        />
      )}

      {step === 2 && build && (
        <ReviewStep
          data={data}
          rows={rows}
          build={build}
          drafts={drafts}
          confirmed={confirmed}
          choices={choices}
          onDraft={(key, draft) => setDrafts((d) => ({ ...d, [key]: draft }))}
          onConfirm={(key, on) => {
            // Confirming without editing keeps the proposed draft.
            const proposal = build.newInstruments.find((n) => n.key === key);
            if (on && proposal) setDrafts((d) => ({ [key]: proposal.instrument, ...d }));
            setConfirmed((c) => ({ ...c, [key]: on }));
          }}
          onChoice={(key, instrumentId) =>
            setChoices((c) => {
              const next = { ...c };
              if (instrumentId) next[key] = instrumentId;
              else delete next[key];
              return next;
            })
          }
        />
      )}

      {step === 3 && impact && (
        <ImpactStep data={data} impact={impact} mode={mode} deposits={deposits} onMode={setMode} />
      )}

      {step === 4 && <div className="notice">{summary}</div>}
    </Modal>
  );
}

/** The subset of saved options the wizard lets the user edit. */
function pickWizardOptions(saved: Partial<StatementOptions>): Partial<WizardOptions> {
  const out: Partial<WizardOptions> = {};
  if (saved.dateOrder) out.dateOrder = saved.dateOrder;
  if (saved.roc) out.roc = saved.roc;
  if (saved.quantityUnit) out.quantityUnit = saved.quantityUnit;
  if (saved.lotSize) out.lotSize = saved.lotSize;
  if (saved.estimateMissingFees !== undefined) out.estimateMissingFees = saved.estimateMissingFees;
  if (saved.defaultCurrency) out.defaultCurrency = saved.defaultCurrency;
  return out;
}
