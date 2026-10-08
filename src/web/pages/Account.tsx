import { useCallback, useState, type FormEvent } from 'react';
import { changePassword, linkGoogle, logout, updateProfile, useAuth } from '../auth';
import { GoogleButton } from '../components/GoogleButton';
import { Badge, Card, Field, PageHeader } from '../components/ui';
import { fmtTime } from '../format';

export default function AccountPage() {
  const { user, config, accountless } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  const run = async (task: () => Promise<void>, done: string) => {
    setMsg(undefined);
    try {
      await task();
      setMsg({ ok: true, text: done });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  const onGoogle = useCallback(
    (idToken: string) => void run(() => linkGoogle(idToken), '已綁定 Google 帳號'),
    [],
  );

  if (accountless || !user) {
    return (
      <>
        <PageHeader title="我的帳號" />
        <div className="notice">目前的後端沒有會員功能：資料只屬於這台裝置或這個單人後端。</div>
      </>
    );
  }

  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 10) return setMsg({ ok: false, text: '新密碼至少 10 個字元' });
    if (newPassword !== confirm) return setMsg({ ok: false, text: '兩次輸入的新密碼不一致' });
    void run(async () => {
      await changePassword(user.hasPassword ? oldPassword : undefined, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
    }, '密碼已更新，其他裝置已登出');
  };

  return (
    <>
      <PageHeader
        title="我的帳號"
        subtitle={`${user.username} · ${user.role === 'admin' ? '管理員' : '會員'}`}
        actions={<button onClick={() => void logout()}>登出</button>}
      />
      {msg && <div className={`notice ${msg.ok ? '' : 'warn'}`}>{msg.text}</div>}

      <div className="grid">
        <Card title="個人資料">
          <div className="form-grid">
            <Field label="帳號">
              <input value={user.username} disabled />
            </Field>
            <Field label="顯示名稱">
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
          </div>
          <p className="actions">
            <button
              className="primary"
              onClick={() => void run(() => updateProfile({ displayName }), '已更新顯示名稱')}
            >
              儲存
            </button>
          </p>
          <p className="muted">
            建立於 {fmtTime(user.createdAt)}；上次登入 {fmtTime(user.lastLoginAt)}
          </p>
        </Card>

        <Card title="管理員檢視權限">
          <p>
            目前：
            {user.allowAdminView ? (
              <Badge tone="warn">允許管理員唯讀檢視</Badge>
            ) : (
              <Badge tone="ok">不允許</Badge>
            )}
          </p>
          <p className="muted">
            允許時，管理員可以唯讀方式開啟你的投資組合以協助排除問題，每次檢視都會留下紀錄，且無法修改你的資料。
            測試階段預設為允許，你可以隨時關閉。
          </p>
          <p className="muted">
            注意：無論這個設定為何，架設後端的人仍能直接存取底層的資料檔或試算表。
          </p>
          <button
            onClick={() =>
              void run(
                () => updateProfile({ allowAdminView: !user.allowAdminView }),
                '已更新檢視權限',
              )
            }
          >
            {user.allowAdminView ? '改為不允許' : '改為允許'}
          </button>
        </Card>

        <Card title={user.hasPassword ? '變更密碼' : '設定密碼'}>
          <form onSubmit={savePassword} className="form-grid">
            {user.hasPassword && (
              <Field label="目前密碼">
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Field>
            )}
            <Field label="新密碼" hint="至少 10 個字元">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="再輸入一次新密碼">
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <div>
              <button className="primary" type="submit">
                更新密碼
              </button>
            </div>
          </form>
          <p className="muted">系統不寄送電子郵件；忘記密碼時請管理員重設。</p>
        </Card>

        <Card title="Google 登入">
          {user.googleLinked ? (
            <p>
              <Badge tone="ok">已綁定</Badge> 可以用 Google 帳號登入。
            </p>
          ) : config?.googleClientId ? (
            <>
              <p className="muted">綁定後可用 Google 帳號登入這個會員。</p>
              <GoogleButton
                clientId={config.googleClientId}
                onToken={onGoogle}
                label="continue_with"
              />
            </>
          ) : (
            <p className="muted">管理員尚未啟用 Google 登入。</p>
          )}
        </Card>
      </div>
    </>
  );
}
