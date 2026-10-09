import { useMemo } from 'react';
import {
  LOW_CONFIDENCE,
  STATEMENT_FIELDS,
  suggestDateOptions,
  suggestQuantityUnit,
  validateMapping,
  type DateOrder,
  type ImportProfile,
  type MappingSuggestion,
  type QuantityUnit,
  type RocMode,
  type StatementField,
  type StatementMapping,
  type StatementTable,
} from '@core/index';
import { Field } from '../../../components/ui';

export interface WizardOptions {
  dateOrder: DateOrder;
  roc: RocMode;
  quantityUnit: QuantityUnit;
  lotSize: number;
  estimateMissingFees: boolean;
  defaultCurrency: string;
}

export interface MappingStepProps {
  table: StatementTable;
  mapping: StatementMapping;
  confidence: MappingSuggestion['confidence'];
  options: WizardOptions;
  profiles: ImportProfile[];
  profileId: string;
  profileScore?: number;
  saveProfile: boolean;
  profileName: string;
  onMapping: (field: StatementField, header: string) => void;
  onOptions: (patch: Partial<WizardOptions>) => void;
  onProfile: (id: string) => void;
  onSaveProfile: (on: boolean) => void;
  onProfileName: (name: string) => void;
}

export default function MappingStep(p: MappingStepProps) {
  const { table, mapping, options } = p;
  const sample = (header?: string) => {
    const i = header ? table.headers.indexOf(header) : -1;
    return i < 0
      ? ''
      : table.rows
          .slice(0, 3)
          .map((r) => r[i])
          .join(' ｜ ');
  };
  const dateHint = useMemo(() => {
    const i = mapping.date ? table.headers.indexOf(mapping.date) : -1;
    return i < 0 ? undefined : suggestDateOptions(table.rows.slice(0, 300).map((r) => r[i] ?? ''));
  }, [table, mapping.date]);
  const unitHint = useMemo(() => suggestQuantityUnit(table, mapping), [table, mapping]);
  const problems = validateMapping(mapping);

  return (
    <div>
      <div className="form-grid">
        <Field
          label="已儲存的設定檔"
          hint={
            p.profileId && p.profileScore !== undefined
              ? `標題相似度 ${(p.profileScore * 100).toFixed(0)}%，已自動套用`
              : undefined
          }
        >
          <select value={p.profileId} onChange={(e) => p.onProfile(e.target.value)}>
            <option value="">（不使用，依標題自動偵測）</option>
            {p.profiles.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="si-block">
        <h3>欄位對應</h3>
        <div className="si-map">
          {STATEMENT_FIELDS.map((f) => {
            const conf = p.confidence[f.key];
            const low = Boolean(mapping[f.key]) && conf !== undefined && conf < LOW_CONFIDENCE;
            return (
              <Field
                key={f.key}
                label={`${f.label}${f.key === 'date' || f.key === 'symbol' ? ' *' : ''}${low ? '（請確認）' : ''}`}
                hint={f.hint}
              >
                <div className={low ? 'si-low' : undefined}>
                  <select
                    value={mapping[f.key] ?? ''}
                    onChange={(e) => p.onMapping(f.key, e.target.value)}
                  >
                    <option value="">（不對應）</option>
                    {table.headers.map((h, i) =>
                      h ? (
                        <option key={i} value={h}>
                          {h}
                        </option>
                      ) : null,
                    )}
                  </select>
                  <span className="si-sample">{sample(mapping[f.key])}</span>
                </div>
              </Field>
            );
          })}
        </div>
        {problems.length > 0 && <div className="notice warn si-block">{problems.join('；')}</div>}
        <p className="si-note">
          沒有「買賣別」欄時，由數量的正負號（負＝賣）或金額的正負號（負＝付出＝買）推導方向；兩者都沒有時該列會標為錯誤。
        </p>
      </div>

      <div className="si-block">
        <h3>解讀選項</h3>
        <div className="form-grid">
          <Field
            label="日期順序（僅影響 月/日/年 這類寫法）"
            hint={
              dateHint?.ambiguous
                ? '此檔案的日期同時符合 月/日/年 與 日/月/年，請自行確認，不會替您猜測'
                : dateHint?.dateOrder
                  ? `依樣本日期判斷為 ${dateHint.dateOrder === 'mdy' ? '月/日/年' : '日/月/年'}`
                  : undefined
            }
          >
            <select
              value={options.dateOrder}
              onChange={(e) => p.onOptions({ dateOrder: e.target.value as DateOrder })}
            >
              <option value="ymd">年/月/日（YYYY-MM-DD、YYYY/MM/DD、YYYYMMDD）</option>
              <option value="mdy">月/日/年（MM/DD/YYYY）</option>
              <option value="dmy">日/月/年（DD/MM/YYYY）</option>
            </select>
          </Field>
          <Field
            label="民國年"
            hint={
              dateHint?.roc
                ? '樣本日期的年份看起來是民國年'
                : '自動：年份小於 200 視為民國年（+1911）'
            }
          >
            <select
              value={options.roc}
              onChange={(e) => p.onOptions({ roc: e.target.value as RocMode })}
            >
              <option value="auto">自動判斷</option>
              <option value="yes">一律視為民國年</option>
              <option value="no">不使用民國年</option>
            </select>
          </Field>
          <Field
            label="股票／ETF 數量單位"
            hint={
              unitHint.unit
                ? `建議：${unitHint.unit === 'lot' ? '張' : '股'}（${unitHint.reason}）；期貨與加密貨幣不換算`
                : '期貨與加密貨幣不換算'
            }
          >
            <select
              value={options.quantityUnit}
              onChange={(e) => p.onOptions({ quantityUnit: e.target.value as QuantityUnit })}
            >
              <option value="share">股（數量即股數）</option>
              <option value="lot">張（每張 {options.lotSize} 股）</option>
            </select>
          </Field>
          <Field
            label="現金列預設幣別"
            hint="對帳單沒有幣別欄時用於入金、出金、股息等；留空則用帳戶幣別"
          >
            <input
              value={options.defaultCurrency}
              onChange={(e) => p.onOptions({ defaultCurrency: e.target.value.toUpperCase() })}
              placeholder="例如 TWD"
            />
          </Field>
        </div>
        <label className="si-radio">
          <input
            type="checkbox"
            checked={options.estimateMissingFees}
            onChange={(e) => p.onOptions({ estimateMissingFees: e.target.checked })}
          />
          <span>
            檔案沒有提供的手續費／稅，依帳戶所屬機構的費率估算（預設關閉；估算的列會在備註標示「估算」）
          </span>
        </label>
      </div>

      <div className="si-block">
        <label className="si-radio">
          <input
            type="checkbox"
            checked={p.saveProfile}
            onChange={(e) => p.onSaveProfile(e.target.checked)}
          />
          <span>匯入確認後，把這組對應與選項儲存為設定檔（下次同格式的檔案自動套用）</span>
        </label>
        {p.saveProfile && (
          <Field label="設定檔名稱">
            <input
              value={p.profileName}
              onChange={(e) => p.onProfileName(e.target.value)}
              placeholder="例如 示範券商甲 成交明細"
            />
          </Field>
        )}
      </div>
    </div>
  );
}
