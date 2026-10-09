import { useRef, useState } from 'react';
import {
  ENCODING_LABELS,
  type Account,
  type Broker,
  type DecodedStatement,
  type Delimiter,
  type Strategy,
  type StatementEncoding,
  type StatementTable,
} from '@core/index';
import { Field } from '../../../components/ui';

export interface FileStepProps {
  fileName?: string;
  decoded?: DecodedStatement;
  table?: StatementTable;
  error?: string;
  accounts: Account[];
  brokers: Broker[];
  strategies: Strategy[];
  accountId: string;
  bucket: string;
  encoding?: StatementEncoding;
  delimiter?: Delimiter;
  headerRow?: number;
  /** Set when the table came from a recognised screenshot. */
  image?: {
    url: string;
    /** Tab-separated text recognised from the image; the user may correct it. */
    text: string;
    uncertain: number;
  };
  /** Recognition in progress: a short description and 0..1. */
  ocr?: { status: string; progress: number };
  onImageText: (text: string) => void;
  onFile: (file: File) => void;
  onAccount: (id: string) => void;
  onBucket: (bucket: string) => void;
  onEncoding: (e: StatementEncoding | undefined) => void;
  onDelimiter: (d: Delimiter | undefined) => void;
  onHeaderRow: (row: number | undefined) => void;
}

const DELIMITER_LABELS: Record<Delimiter, string> = { ',': '逗號 ,', '\t': 'Tab', ';': '分號 ;' };

export default function FileStep(p: FileStepProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const preview = p.table?.records.slice(
    0,
    Math.min(p.table.records.length, (p.table.headerRow ?? 0) + 8),
  );

  return (
    <div>
      <div className="notice">
        檔案與截圖只在這個瀏覽器內處理，不會上傳到任何伺服器；按下最後一步的「確認匯入」之前不會寫入任何資料。
        截圖會在瀏覽器內辨識文字：第一次使用需下載辨識引擎與語言資料（約 20
        MB），圖片本身不會離開這台裝置。
      </div>
      <div className="form-grid si-block">
        <Field label="匯入到帳戶">
          <select value={p.accountId} onChange={(e) => p.onAccount(e.target.value)}>
            {p.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{p.brokers.find((b) => b.id === a.brokerId)?.name ?? '—'}，
                {a.baseCurrency}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="歸屬資金桶" hint="核心被動，或選擇一個策略">
          <select value={p.bucket} onChange={(e) => p.onBucket(e.target.value)}>
            <option value="core">核心（被動）</option>
            {p.strategies.map((s) => (
              <option key={s.id} value={s.id}>
                策略：{s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div
        className={`si-drop si-block ${over ? 'over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => ref.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) p.onFile(f);
        }}
      >
        {p.fileName
          ? `已選擇：${p.fileName}（點擊或拖放以更換）`
          : '把券商／交易所匯出的成交紀錄 CSV，或成交明細的截圖，拖放到這裡，或點擊選擇檔案'}
        <input
          ref={ref}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain,image/png,image/jpeg,image/webp,image/bmp,image/gif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {p.error && <div className="notice warn si-block">{p.error}</div>}

      {p.ocr && (
        <div className="notice si-block">
          辨識截圖中：{p.ocr.status}（{Math.round(p.ocr.progress * 100)}%）
          <progress className="si-progress" value={p.ocr.progress} max={1} />
        </div>
      )}

      {p.image && (
        <div className="si-block">
          <h3>截圖辨識結果</h3>
          <div className="notice warn">
            文字辨識會出錯，數字尤其容易看錯（例如 0 與 O、1 與 l、小數點與千分位）。
            請對照左邊的截圖，直接在右邊修正；每一列是一筆、欄位之間以 Tab 分隔。
            {p.image.uncertain > 0 && ` 引擎對其中 ${p.image.uncertain} 個儲存格較沒把握。`}
          </div>
          <div className="si-ocr">
            <img src={p.image.url} alt="上傳的對帳單截圖" />
            <textarea
              value={p.image.text}
              spellCheck={false}
              onChange={(e) => p.onImageText(e.target.value)}
              onKeyDown={(e) => {
                // Tab separates columns here, so it must insert one, not move focus.
                if (e.key !== 'Tab') return;
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart, selectionEnd, value } = el;
                p.onImageText(`${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`);
                requestAnimationFrame(() =>
                  el.setSelectionRange(selectionStart + 1, selectionStart + 1),
                );
              }}
            />
          </div>
        </div>
      )}

      {p.decoded && p.table && (
        <>
          <div className="form-grid si-block">
            {!p.image && (
              <Field
                label="文字編碼"
                hint={`偵測結果：${ENCODING_LABELS[p.decoded.encoding]}${p.encoding ? '（手動指定）' : ''}`}
              >
                <select
                  value={p.encoding ?? ''}
                  onChange={(e) =>
                    p.onEncoding((e.target.value || undefined) as StatementEncoding | undefined)
                  }
                >
                  <option value="">自動偵測</option>
                  {(Object.keys(ENCODING_LABELS) as StatementEncoding[]).map((k) => (
                    <option key={k} value={k}>
                      {ENCODING_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="分隔符號" hint={`偵測結果：${DELIMITER_LABELS[p.table.delimiter]}`}>
              <select
                value={p.delimiter ?? ''}
                onChange={(e) =>
                  p.onDelimiter((e.target.value || undefined) as Delimiter | undefined)
                }
              >
                <option value="">自動偵測</option>
                {(Object.keys(DELIMITER_LABELS) as Delimiter[]).map((d) => (
                  <option key={d} value={d}>
                    {DELIMITER_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="標題列（第幾列）"
              hint={`偵測為第 ${p.table.headerRow + 1} 列；上方為表頭說明`}
            >
              <input
                type="number"
                min={1}
                max={Math.max(p.table.records.length, 1)}
                value={p.headerRow !== undefined ? p.headerRow + 1 : ''}
                placeholder={String(p.table.headerRow + 1)}
                onChange={(e) =>
                  p.onHeaderRow(
                    e.target.value ? Math.max(Number(e.target.value) - 1, 0) : undefined,
                  )
                }
              />
            </Field>
          </div>
          {p.decoded.text.includes('�') && (
            <div className="notice warn si-block">
              文字中有無法辨識的字元（�），編碼可能不對，請改選另一種編碼。
            </div>
          )}
          <div className="si-block">
            <h3>
              原始內容預覽（共 {p.table.records.length} 列，資料 {p.table.rows.length} 列
              {p.table.summaryRows ? `，已排除 ${p.table.summaryRows} 列合計` : ''}）
            </h3>
            <div className="si-raw">
              <table>
                <tbody>
                  {preview?.map((rec, i) => (
                    <tr
                      key={i}
                      className={
                        i === p.table!.headerRow ? 'header' : i < p.table!.headerRow ? 'pre' : ''
                      }
                    >
                      <td className="muted">{i + 1}</td>
                      {rec.map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
