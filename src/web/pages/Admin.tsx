import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuditEntry, PublicUser, RegistrationMode, UserStatus } from '@core/api';
import { api, derivePasswordKey, useAuth, viewAs } from '../auth';
import { Badge, Card, Empty, Field, Modal, PageHeader } from '../components/ui';
import { fmtTime } from '../format';

const STATUS: Record<UserStatus, { tone: 'ok' | 'warn' | 'bad'; text: string }> = {
  active: { tone: 'ok', text: '啟用中' },
  pending: { tone: 'warn', text: '待核准' },
  disabled: { tone: 'bad', text: '已停用' },
};

const ACTIONS: Record<string, string> = {
  register: '註冊',
  'set-status': '變更狀態',
  'set-role': '變更角色',
  'reset-password': '重設密碼',
  'change-password': '變更密碼',
  'delete-user': '刪除帳號',
  'view-data': '檢視資料',
  'set-admin-view': '變更檢視權限',
  'set-registration': '變更註冊模式',
  'set-google-client': '設定 Google 用戶端',
  'link-google': '綁定 Google',
};

export default function AdminPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [registration, setRegistration] = useState<RegistrationMode>(
    auth.config?.registration ?? 'approval',
  );
  const [googleClientId, setGoogleClientId] = useState(auth.config?.googleClientId ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [resetting, setResetting] = useState<PublicUser>();
  const isAdmin = auth.user?.role === 'admin';

  const refresh = useCallback(async () => {
    const [u, a] = await Promise.all([
      api({ action: 'adminUsers' }),
      api({ action: 'adminAudit' }),
    ]);
    setUsers(u.users ?? []);
    setAudit(a.audit ?? []);
  }, []);

  const run = useCallback(
    async (task: () => Promise<unknown>, done: string) => {
      setMsg(undefined);
      try {
        await task();
        setMsg({ ok: true, text: done });
        await refresh();
      } catch (err) {
        setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (isAdmin) void refresh().catch((err: Error) => setMsg({ ok: false, text: err.message }));
  }, [isAdmin, refresh]);

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="會員管理" />
        <div className="notice warn">只有管理員可以使用這個頁面。</div>
      </>
    );
  }

  const update = (
    u: PublicUser,
    patch: { status?: UserStatus; role?: PublicUser['role'] },
    done: string,
  ) => void run(() => api({ action: 'adminUpdateUser', userId: u.id, ...patch }), done);

  const remove = (u: PublicUser) => {
    if (!window.confirm(`刪除帳號「${u.username}」及其全部資料？這個動作無法復原。`)) return;
    void run(() => api({ action: 'adminDeleteUser', userId: u.id }), `已刪除 ${u.username}`);
  };

  const open = async (u: PublicUser) => {
    setMsg(undefined);
    try {
      await viewAs(u);
      navigate('/');
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  const pending = users.filter((u) => u.status === 'pending').length;

  return (
    <>
      <PageHeader
        title="會員管理"
        subtitle={`${users.length} 個帳號${pending ? `，${pending} 個待核准` : ''}`}
      />
      {msg && <div className={`notice ${msg.ok ? '' : 'warn'}`}>{msg.text}</div>}

      <Card title="會員">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>帳號</th>
                <th>顯示名稱</th>
                <th>角色</th>
                <th>狀態</th>
                <th>登入方式</th>
                <th>上次登入</th>
                <th>允許檢視</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === auth.user?.id;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.username}
                      {self && <span className="muted">（你）</span>}
                    </td>
                    <td>{u.displayName}</td>
                    <td>{u.role === 'admin' ? '管理員' : '會員'}</td>
                    <td>
                      <Badge tone={STATUS[u.status].tone}>{STATUS[u.status].text}</Badge>
                    </td>
                    <td>
                      {[u.hasPassword && '密碼', u.googleLinked && 'Google']
                        .filter(Boolean)
                        .join('、') || '—'}
                    </td>
                    <td>{fmtTime(u.lastLoginAt)}</td>
                    <td>{u.allowAdminView ? '是' : '否'}</td>
                    <td className="actions">
                      {u.status !== 'active' && (
                        <button
                          className="primary"
                          onClick={() => update(u, { status: 'active' }, `已啟用 ${u.username}`)}
                        >
                          {u.status === 'pending' ? '核准' : '重新啟用'}
                        </button>
                      )}
                      {u.status === 'active' && !self && (
                        <button
                          onClick={() => update(u, { status: 'disabled' }, `已停用 ${u.username}`)}
                        >
                          停用
                        </button>
                      )}
                      <button
                        onClick={() =>
                          update(
                            u,
                            { role: u.role === 'admin' ? 'member' : 'admin' },
                            `已變更 ${u.username} 的角色`,
                          )
                        }
                      >
                        {u.role === 'admin' ? '改為會員' : '設為管理員'}
                      </button>
                      {auth.config?.passwordLogin !== false && (
                        <button onClick={() => setResetting(u)}>重設密碼</button>
                      )}
                      {!self && u.allowAdminView && u.status === 'active' && (
                        <button onClick={() => void open(u)}>唯讀檢視</button>
                      )}
                      {!self && (
                        <button className="danger" onClick={() => remove(u)}>
                          刪除
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">
          只有會員自己允許時才能唯讀檢視其資料，每次檢視都會記錄在下方。管理員無法修改其他會員的資料。
        </p>
      </Card>

      <div className="grid">
        <Card title="註冊方式">
          <Field label="新帳號" hint="管理員審核：註冊後須核准才能登入。開放註冊：註冊後立即可用。">
            <select
              value={registration}
              onChange={(e) => setRegistration(e.target.value as RegistrationMode)}
            >
              <option value="approval">管理員審核</option>
              <option value="open">開放註冊</option>
            </select>
          </Field>
          <p className="actions">
            <button
              className="primary"
              onClick={() =>
                void run(() => api({ action: 'adminSetConfig', registration }), '已更新註冊方式')
              }
            >
              儲存
            </button>
          </p>
          {registration === 'open' && (
            <p className="warn">開放註冊後，任何知道網址的人都能建立帳號並占用後端的資源與配額。</p>
          )}
        </Card>

        <Card title="Google 登入">
          <Field
            label="OAuth 用戶端 ID"
            hint="在 Google Cloud Console 建立「網頁應用程式」用戶端，並把本網站的網址加入已授權的 JavaScript 來源。留空則停用。"
          >
            <input
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
              placeholder="xxxxxxxx.apps.googleusercontent.com"
            />
          </Field>
          <p className="actions">
            <button
              className="primary"
              onClick={() =>
                void run(
                  () => api({ action: 'adminSetConfig', googleClientId: googleClientId.trim() }),
                  '已更新 Google 登入設定',
                )
              }
            >
              儲存
            </button>
          </p>
          <p className="muted">
            用戶端 ID 不是機密，但它存在後端而不是程式碼裡。GAS 後端若設定了指令碼屬性
            GOOGLE_CLIENT_ID，會以該屬性為準。
          </p>
        </Card>
      </div>

      <Card title="稽核紀錄">
        {audit.length === 0 ? (
          <Empty>尚無紀錄</Empty>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>時間</th>
                  <th>執行者</th>
                  <th>動作</th>
                  <th>對象</th>
                  <th>說明</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtTime(a.at)}</td>
                    <td>{a.actorName}</td>
                    <td>{ACTIONS[a.action] ?? a.action}</td>
                    <td>{a.targetName ?? '—'}</td>
                    <td>{a.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {resetting && (
        <ResetPassword
          user={resetting}
          onClose={() => setResetting(undefined)}
          onDone={(text) => {
            setResetting(undefined);
            void run(async () => undefined, text);
          }}
        />
      )}
    </>
  );
}

function ResetPassword(props: {
  user: PublicUser;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    if (password.length < 10) return setError('密碼至少 10 個字元');
    try {
      const newPasswordKey = await derivePasswordKey(props.user.username, password);
      await api({ action: 'adminUpdateUser', userId: props.user.id, newPasswordKey });
      props.onDone(`已重設 ${props.user.username} 的密碼，該會員的所有裝置已登出`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Modal
      title={`重設密碼：${props.user.username}`}
      onClose={props.onClose}
      footer={
        <>
          <button className="ghost" onClick={props.onClose}>
            取消
          </button>
          <button className="primary" onClick={() => void save()}>
            重設
          </button>
        </>
      }
    >
      {error && <div className="notice warn">{error}</div>}
      <Field label="新密碼" hint="請用安全的方式把新密碼交給該會員，並請對方登入後自行變更。">
        <input
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
        />
      </Field>
    </Modal>
  );
}
