import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';

function useGoogleCredential(callback) {
  const buttonRef = useRef(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    if (window.google?.accounts?.id) { setReady(true); return; }
    const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT}"]`);
    const script = existing || document.createElement('script');
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => setReady(true);
    if (!existing) document.body.appendChild(script);
  }, [clientId]);

  useEffect(() => {
    if (!ready || !clientId || !buttonRef.current || !window.google?.accounts?.id) return;
    window.google.accounts.id.initialize({ client_id: clientId, callback: ({ credential }) => credential && callback(credential) });
    window.google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', text: 'continue_with', width: 260 });
  }, [ready, clientId, callback]);

  return { buttonRef, configured: Boolean(clientId) };
}

function ProfileNotice({ notice, onClose }) {
  if (!notice?.message) return null;
  const icon = notice.type === 'success' ? '✓' : notice.type === 'error' ? '⚠' : notice.type === 'warning' ? '!' : 'i';
  return (
    <div className={`profile-notice ${notice.type || 'info'}`} role="status">
      <span className="profile-notice__icon" aria-hidden="true">{icon}</span>
      <div>
        {notice.title ? <strong>{notice.title}</strong> : null}
        <p>{notice.message}</p>
      </div>
      <button type="button" className="profile-notice__close" onClick={onClose} aria-label="Đóng thông báo">×</button>
    </div>
  );
}

function fmtDate(value) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(value)); } catch { return value; }
}

export default function ProfilePage() {
  const { token, user, updateUserContext, logoutContext } = useAuth();
  const [profile, setProfile] = useState(null);
  const [activity, setActivity] = useState(null);
  const [tab, setTab] = useState('basic');
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);

  const showSuccess = (text) => setNotice({ type: 'success', message: text });
  const showError = (err) => setNotice({ type: 'error', message: err?.message || 'Đã có lỗi xảy ra.' });
  const switchTab = (nextTab) => { setTab(nextTab); setNotice(null); };

  const load = async () => {
    setLoading(true);
    try {
      const [profileResp, activityResp] = await Promise.all([api.getProfile(token), api.getProfileActivity(token)]);
      setProfile(profileResp.user);
      updateUserContext(profileResp.user);
      setActivity(activityResp);
    } catch (err) { showError(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateProfile = (nextUser) => {
    setProfile(nextUser);
    updateUserContext(nextUser);
  };

  const tabs = [
    ['basic', 'Thông tin cá nhân'], ['security', 'Bảo mật'], ['social', 'Liên kết tài khoản'],
    ['activity', 'Hoạt động'], ['data', 'Tài khoản'],
  ];

  return (
    <main className="profile-page app-scrollbar">
      <style>{styles}</style>
      <header className="profile-hero">
        <div>
          <p className="eyebrow">AI Researching Assistant</p>
          <h1>Hồ sơ cá nhân</h1>
          <p>Quản lý danh tính, bảo mật, dữ liệu cá nhân và trải nghiệm làm việc của bạn.</p>
        </div>
        <div className="hero-user">
          {profile?.avatar_url ? <img src={profile.avatar_url} alt="Avatar" /> : <span>{(profile?.email || user?.email || 'U').charAt(0).toUpperCase()}</span>}
          <div><strong>{profile?.display_name || profile?.full_name || profile?.name || user?.email}</strong><small>{profile?.email || user?.email}</small></div>
        </div>
      </header>

      <ProfileNotice notice={notice} onClose={() => setNotice(null)} />

      <nav className="profile-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => switchTab(id)}>{label}</button>)}</nav>

      {loading ? <section className="card">Đang tải hồ sơ...</section> : null}
      {!loading && profile && tab === 'basic' && <BasicInfo profile={profile} token={token} onUpdate={updateProfile} onSuccess={showSuccess} onError={showError} />}
      {!loading && profile && tab === 'security' && <Security profile={profile} token={token} onUpdate={updateProfile} onSuccess={showSuccess} onError={showError} />}
      {!loading && profile && tab === 'social' && <SocialLinks profile={profile} token={token} onUpdate={updateProfile} onSuccess={showSuccess} onError={showError} />}
      {!loading && tab === 'activity' && <Activity activity={activity} />}
      {!loading && profile && tab === 'data' && <DataAccount token={token} onSuccess={showSuccess} onError={showError} logoutContext={logoutContext} />}
    </main>
  );
}

function BasicInfo({ profile, token, onUpdate, onSuccess, onError }) {
  const [form, setForm] = useState({ full_name: profile.full_name || '', username: profile.username || profile.display_name || '', gender: profile.gender || 'prefer_not_to_say', date_of_birth: profile.date_of_birth || '' });
  const [preview, setPreview] = useState(profile.avatar_url || '');
  const [file, setFile] = useState(null);

  const chooseAvatar = (event) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  };
  const cropSquareAndUpload = async () => {
    if (!file) return;
    const img = new Image();
    img.src = preview;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    const side = Math.min(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 512, 512);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, file.type || 'image/png', 0.9));
    const cropped = new File([blob], file.name, { type: blob.type });
    try { const resp = await api.uploadAvatar(cropped, token); onUpdate(resp.user); setFile(null); onSuccess('Đã cập nhật avatar.'); }
    catch (err) { onError(err); }
  };
  const submit = async (event) => {
    event.preventDefault();
    try { const resp = await api.updateProfile({ ...form, display_name: form.username, date_of_birth: form.date_of_birth || null }, token); onUpdate(resp.user); onSuccess('Đã lưu thông tin cá nhân.'); }
    catch (err) { onError(err); }
  };
  return <section className="grid two"><div className="card avatar-card"><h2>Avatar</h2><div className="avatar-editor">{preview ? <img src={preview} alt="Preview avatar" /> : <span>{profile.email.charAt(0).toUpperCase()}</span>}</div><div className="avatar-identity"><strong>{form.username || form.full_name || profile.email}</strong><small>{profile.email}</small></div><label className="avatar-file-button">Chọn ảnh mới<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseAvatar} /></label><p className="muted">Ảnh được crop vuông bằng canvas trước khi upload. Tối đa 5MB.</p><button className="primary" disabled={!file} onClick={cropSquareAndUpload}>Upload avatar</button></div><form className="card form" onSubmit={submit}><h2>Thông tin cá nhân</h2><label>Họ và tên<input value={form.full_name} onChange={e=>setForm({...form, full_name:e.target.value})} /></label><label>Username<input value={form.username} onChange={e=>setForm({...form, username:e.target.value})} placeholder="Tên dùng để đăng nhập" /></label><label>Email<input value={profile.email} disabled /></label><label>Giới tính<select value={form.gender} onChange={e=>setForm({...form, gender:e.target.value})}><option value="male">Nam</option><option value="female">Nữ</option><option value="other">Khác</option><option value="prefer_not_to_say">Không muốn nói</option></select></label><label>Ngày sinh<input type="date" value={form.date_of_birth || ''} onChange={e=>setForm({...form, date_of_birth:e.target.value})} /></label><button className="primary">Lưu thay đổi</button></form></section>;
}

function PasswordField({ label, value, onChange, required = false, disabled = false, autoComplete, minLength }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="password-field">
      <span className="password-label">{label}</span>
      <span className="password-input-wrap">
        <input
          type={visible ? 'text' : 'password'}
          minLength={minLength}
          value={value}
          onChange={onChange}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
        />
        <button type="button" className="password-toggle" onClick={() => setVisible((next) => !next)} disabled={disabled} aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
          {visible ? 'Ẩn' : 'Hiện'}
        </button>
      </span>
    </label>
  );
}

function Security({ profile, token, onUpdate, onSuccess, onError }) {
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [reset, setReset] = useState({ email: profile.email, otp: '', new_password: '', confirm: '' });
  const [resetStep, setResetStep] = useState('email');
  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) return onError(new Error('Mật khẩu xác nhận không khớp.'));
    setPasswordSubmitting(true);
    try {
      const resp = await api.changePassword({ current_password: pw.current_password || null, new_password: pw.new_password }, token);
      onSuccess(resp.message);
      setPw({ current_password: '', new_password: '', confirm: '' });
      onUpdate({ ...profile, has_password: true, default_password_must_change: false });
    } catch (err) { onError(err); }
    finally { setPasswordSubmitting(false); }
  };

  const requestOtp = async () => {
    try {
      await api.requestPasswordResetOtp(profile.email || reset.email);
      setResetStep('otp');
      onSuccess('Mã xác thực đã được gửi nếu email tồn tại.');
    } catch (err) { onError(err); }
  };

  const verifyOtp = async () => {
    if (!/^\d{4}$/.test(reset.otp)) return onError(new Error('Vui lòng nhập OTP gồm 4 số.'));
    try {
      const resp = await api.verifyPasswordResetOtp(profile.email || reset.email, reset.otp);
      setResetStep('password');
      onSuccess(resp.message || 'Mã xác thực hợp lệ.');
    } catch (err) { onError(err); }
  };

  const confirmReset = async (e) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(reset.otp)) return onError(new Error('Vui lòng nhập OTP gồm 4 số.'));
    if (reset.new_password !== reset.confirm) return onError(new Error('Mật khẩu nhập lại không khớp.'));
    try {
      const resp = await api.confirmPasswordResetWithOtp(profile.email || reset.email, reset.otp, reset.new_password);
      onSuccess(resp.message || 'Đã cập nhật mật khẩu.');
      setReset({ email: profile.email, otp: '', new_password: '', confirm: '' });
      setResetStep('email');
      onUpdate({ ...profile, has_password: true, default_password_must_change: false });
    } catch (err) { onError(err); }
  };

  const toggle2fa = async () => { try { const resp = profile.email_2fa_enabled ? await api.disableEmail2fa(token) : await api.enableEmail2fa(token); if (resp.user) onUpdate(resp.user); onSuccess(resp.message); } catch (err) { onError(err); } };

  return (
    <section className="grid two">
      <form className="card password-change-card" onSubmit={changePassword}>
        <div className="password-card-header">
          <h2>Đổi mật khẩu</h2>
          <p>Cập nhật mật khẩu đăng nhập cho tài khoản hiện tại.</p>
        </div>
        {profile.default_password_must_change ? <p className="password-warning">Bạn nên đặt mật khẩu mới cho tài khoản này.</p> : null}
        <div className="password-change-form">
          <PasswordField label="Mật khẩu hiện tại" value={pw.current_password} onChange={e=>setPw({...pw,current_password:e.target.value})} required disabled={passwordSubmitting} autoComplete="current-password" />
          <PasswordField label="Mật khẩu mới" value={pw.new_password} onChange={e=>setPw({...pw,new_password:e.target.value})} required disabled={passwordSubmitting} autoComplete="new-password" minLength={6} />
          <PasswordField label="Xác nhận mật khẩu mới" value={pw.confirm} onChange={e=>setPw({...pw,confirm:e.target.value})} required disabled={passwordSubmitting} autoComplete="new-password" minLength={6} />
        </div>
        <button className="password-submit" disabled={passwordSubmitting}>{passwordSubmitting ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}</button>
        <div className="password-helper"><span aria-hidden="true">i</span><p>Luồng này yêu cầu mật khẩu hiện tại và chỉ cập nhật bằng phiên đăng nhập hiện tại nếu quyền admin backend bị giới hạn.</p></div>
      </form>

      <div className="card form">
        <h2>Đặt lại mật khẩu qua email</h2>
        <label className="reset-email-display">Email nhận OTP<input type="email" value={profile.email || reset.email} disabled readOnly /></label>
        <button type="button" className="secondary" onClick={requestOtp}>Gửi mã OTP</button>
        <label>OTP 4 số<input inputMode="numeric" pattern="\d{4}" maxLength={4} value={reset.otp} onChange={e=>setReset({...reset,otp:e.target.value.replace(/\D/g,'').slice(0,4)})} placeholder="••••" /></label>
        <button type="button" className="secondary" onClick={verifyOtp} disabled={resetStep === 'email'}>Xác thực OTP</button>
        <form className="nested-form" onSubmit={confirmReset}>
          <label>Mật khẩu mới<input type="password" minLength={6} value={reset.new_password} onChange={e=>setReset({...reset,new_password:e.target.value})} required disabled={resetStep !== 'password'} /></label>
          <label>Nhập lại mật khẩu mới<input type="password" minLength={6} value={reset.confirm} onChange={e=>setReset({...reset,confirm:e.target.value})} required disabled={resetStep !== 'password'} /></label>
          <button className="primary" disabled={resetStep !== 'password'}>Đặt lại mật khẩu</button>
        </form>
        <p className="muted">Reset mật khẩu không cần mật khẩu hiện tại và dùng được cho cả tài khoản đăng ký thường lẫn tài khoản Google.</p>
        <div className="divider" />
        <p>2FA email: <strong>{profile.email_2fa_enabled ? 'Đang bật' : 'Đang tắt'}</strong></p>
        <p className="muted">OTP gồm 4 số được gửi qua email để xác nhận trước khi đặt lại mật khẩu.</p>
        <button className="secondary" onClick={toggle2fa}>{profile.email_2fa_enabled ? 'Tắt 2FA email' : 'Bật 2FA email'}</button>
      </div>
    </section>
  );
}


function SocialLinks({ profile, token, onUpdate, onSuccess, onError }) {
  const onCredential = async (credential) => { try { const resp = await api.connectGoogle(credential, token); onUpdate(resp.user); onSuccess(resp.message); } catch (err) { onError(err); } };
  const { buttonRef, configured } = useGoogleCredential(onCredential);
  const disconnect = async () => { try { const resp = await api.disconnectGoogle(token); onUpdate(resp.user); onSuccess(resp.message); } catch (err) { onError(err); } };
  const googleLabel = profile.google_connected
    ? `Google đã kết nối${profile.google_email ? `: ${profile.google_email}` : ''}`
    : 'Chưa kết nối';
  return <section className="card"><h2>Liên kết tài khoản</h2><div className="social-row"><div><strong>Google</strong><p>{googleLabel}</p></div>{profile.google_connected ? <button className="danger-soft" onClick={disconnect}>Ngắt kết nối Google</button> : configured ? <div ref={buttonRef} /> : <span className="muted">Cần cấu hình VITE_GOOGLE_CLIENT_ID.</span>}</div><p className="muted">Có thể liên kết Gmail khác email hồ sơ nếu Google account hợp lệ và chưa được liên kết với tài khoản khác. Chỉ cho ngắt Google khi tài khoản còn cách đăng nhập khác bằng mật khẩu.</p></section>;
}


function Activity({ activity }) {
  const stats = activity?.stats || {};
  return <section className="card"><h2>Lịch sử hoạt động</h2><div className="stats"><div><strong>{fmtDate(activity?.account_created_at)}</strong><span>Ngày tạo tài khoản</span></div><div><strong>{stats.notebooks ?? 0}</strong><span>Notebook</span></div><div><strong>{stats.documents ?? 0}</strong><span>Tài liệu</span></div><div><strong>{stats.research_sessions ?? 0}</strong><span>Phiên nghiên cứu</span></div><div><strong>{stats.notes ?? 0}</strong><span>Note</span></div></div><ul className="timeline">{(activity?.recent_activity || []).map((item, idx)=><li key={`${item.type}-${idx}`}><span>{item.label}</span><time>{fmtDate(item.created_at)}</time></li>)}{!activity?.recent_activity?.length && <li>Chưa có hoạt động gần đây.</li>}</ul></section>;
}

function DataAccount({ token, onError, logoutContext }) {
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const deactivate = async () => { try { await api.deactivateAccount(token); logoutContext(); window.location.href = '/login'; } catch (err) { onError(err); } };
  const remove = async () => { try { await api.deleteAccount(token); logoutContext(); window.location.href = '/login'; } catch (err) { onError(err); } };
  return <section className="grid two"><div className="card danger-zone"><h2>Danger zone</h2><button className="danger-soft" onClick={()=>setDeactivateOpen(true)}>Vô hiệu hóa tài khoản</button>{deactivateOpen && <div className="confirm"><p>Bạn có chắc muốn vô hiệu hóa tài khoản? Dữ liệu không bị xóa và bạn sẽ được đăng xuất.</p><button className="danger" onClick={deactivate}>Xác nhận vô hiệu hóa</button><button className="secondary" onClick={()=>setDeactivateOpen(false)}>Hủy</button></div>}<div className="divider" /><label>Nhập <strong>XOA TAI KHOAN</strong> để xóa/ẩn danh hồ sơ<input value={deleteText} onChange={e=>setDeleteText(e.target.value)} /></label><button className="danger" disabled={deleteText !== 'XOA TAI KHOAN'} onClick={remove}>Xóa tài khoản vĩnh viễn</button></div></section>;
}

const styles = `
.profile-page{--profile-bg:#0f0d0a;--profile-surface:#17130f;--profile-surface-strong:#1e1912;--profile-border:rgba(255,255,255,.08);--profile-border-strong:rgba(196,164,100,.24);--profile-text:#e7dfd0;--profile-muted:#8a8070;--profile-gold:#c4a464;min-height:100vh;padding:28px;color:var(--profile-text);font-family:'DM Sans',system-ui,sans-serif;max-width:1200px;margin:0 auto;background:radial-gradient(circle at 20% 0%,rgba(196,164,100,.12),transparent 34%),linear-gradient(180deg,rgba(18,15,11,.98),rgba(12,10,8,.98));}.profile-hero{display:flex;justify-content:space-between;gap:20px;align-items:center;background:linear-gradient(135deg,rgba(196,164,100,.12),rgba(255,255,255,.035));border:1px solid var(--profile-border);border-radius:28px;padding:28px;box-shadow:0 24px 70px rgba(0,0,0,.28)}.eyebrow{letter-spacing:.12em;text-transform:uppercase;color:#d6b36a;font-size:12px;font-weight:800}.profile-hero h1{font-family:'Lora',serif;font-size:38px;margin:8px 0;color:#f2eadb}.profile-hero p{color:var(--profile-muted);margin:0}.hero-user{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.045);border:1px solid var(--profile-border);border-radius:20px;padding:12px 14px;min-width:260px}.hero-user img,.hero-user span,.avatar-editor img,.avatar-editor span{width:58px;height:58px;border-radius:18px;object-fit:cover;background:linear-gradient(135deg,#f2d48b,#a8792f);color:#1a1510;display:grid;place-items:center;font-weight:800}.hero-user small{display:block;color:var(--profile-muted)}.profile-notice{margin:16px 0;padding:13px 14px;border-radius:16px;border:1px solid;display:grid;grid-template-columns:auto 1fr auto;align-items:start;gap:10px;background:rgba(255,255,255,.045);box-shadow:0 18px 44px rgba(0,0,0,.16)}.profile-notice p{margin:2px 0 0;color:inherit}.profile-notice.success{background:rgba(34,197,94,.1);border-color:rgba(74,222,128,.24);color:#bbf7d0}.profile-notice.error{background:rgba(244,63,94,.1);border-color:rgba(251,113,133,.24);color:#fecdd3}.profile-notice.info{background:rgba(59,130,246,.1);border-color:rgba(96,165,250,.24);color:#bfdbfe}.profile-notice.warning{background:rgba(245,158,11,.1);border-color:rgba(251,191,36,.24);color:#fde68a}.profile-notice__icon{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;background:rgba(255,255,255,.08);font-weight:900}.profile-notice__close{border:0;background:transparent;color:currentColor;font-size:22px;line-height:1;cursor:pointer;opacity:.72}.profile-notice__close:hover{opacity:1}.profile-tabs{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.profile-tabs button{border:1px solid var(--profile-border);background:rgba(255,255,255,.035);border-radius:999px;padding:10px 14px;cursor:pointer;color:#b5aa98;font-weight:700}.profile-tabs button:hover{border-color:var(--profile-border-strong);color:#f2eadb}.profile-tabs button.active{background:linear-gradient(135deg,rgba(196,164,100,.22),rgba(196,164,100,.08));color:#f5db98;border-color:rgba(196,164,100,.35);box-shadow:inset 0 0 0 1px rgba(242,212,139,.08)}.grid{display:grid;gap:18px}.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.card{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.028));border:1px solid var(--profile-border);border-radius:24px;padding:24px;box-shadow:0 22px 60px rgba(0,0,0,.22);color:var(--profile-text)}.card h2{font-family:'Lora',serif;margin:0 0 16px;color:#f2eadb}.card p{color:#a79b8a}.form{display:grid;gap:14px}.form label,.danger-zone label{display:grid;gap:7px;font-weight:700;color:#cfc5b5}.form input,.form select,.danger-zone input{border:1px solid var(--profile-border);border-radius:12px;padding:11px 12px;background:rgba(10,8,6,.58);color:var(--profile-text);outline:none}.form input:focus,.form select:focus,.danger-zone input:focus{border-color:rgba(196,164,100,.45);box-shadow:0 0 0 3px rgba(196,164,100,.12)}.form input:disabled{color:#7f7567;background:rgba(255,255,255,.035)}.password-change-card{display:flex;flex-direction:column;gap:0;padding:26px;border-radius:26px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid var(--profile-border);box-shadow:0 24px 68px rgba(0,0,0,.24);min-height:100%}.password-card-header{display:grid;gap:6px;margin:0 0 24px}.password-card-header h2{font-size:24px;margin:0;color:#f5ead8}.password-card-header p{margin:0;color:var(--profile-muted);font-size:14px;line-height:1.55}.password-warning{margin:-6px 0 20px;padding:11px 13px;border-radius:14px;border:1px solid rgba(251,191,36,.2);background:rgba(245,158,11,.08);color:#fde68a;font-size:13px;line-height:1.5}.password-change-form{display:grid;gap:22px}.password-field{display:grid;gap:8px;font-weight:800;color:#d7cab8}.password-label{font-size:13px;letter-spacing:.01em}.password-input-wrap{position:relative;display:block}.password-input-wrap input{width:100%;height:48px;padding:0 82px 0 14px;border:1px solid rgba(255,255,255,.1);border-radius:15px;background:rgba(10,8,6,.64);color:#f2eadb;outline:none;font-size:14px;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}.password-input-wrap input:focus{border-color:rgba(196,164,100,.5);box-shadow:0 0 0 3px rgba(196,164,100,.12);background:rgba(14,11,8,.82)}.password-toggle{position:absolute;right:8px;top:50%;transform:translateY(-50%);height:32px;min-width:58px;border:1px solid rgba(196,164,100,.18);border-radius:999px;padding:0 11px;background:rgba(196,164,100,.08);color:#efd28c;font-size:12px;font-weight:800;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .16s ease}.password-toggle:hover:not(:disabled){background:rgba(196,164,100,.16);border-color:rgba(196,164,100,.35)}.password-toggle:disabled{opacity:.48;cursor:not-allowed}.password-submit{width:100%;height:54px;margin-top:30px;border:0;border-radius:18px;background:linear-gradient(135deg,#f6d98f 0%,#d8ab4e 48%,#9a6a24 100%);color:#17110a;font-size:15px;font-weight:900;cursor:pointer;box-shadow:0 16px 34px rgba(196,164,100,.22);transition:filter .16s ease,transform .16s ease,box-shadow .16s ease}.password-submit:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 20px 42px rgba(196,164,100,.3)}.password-submit:disabled{opacity:.58;cursor:not-allowed;transform:none;filter:saturate(.75)}.password-helper{display:flex;gap:10px;margin-top:18px;padding:14px;border:1px solid rgba(196,164,100,.16);border-radius:18px;background:rgba(196,164,100,.055);color:var(--profile-muted)}.password-helper span{flex:0 0 auto;width:20px;height:20px;border-radius:999px;display:grid;place-items:center;background:rgba(196,164,100,.16);color:#f4d891;font-weight:900;font-size:12px}.password-helper p{margin:0;color:#a99d8c;font-size:13px;line-height:1.6}.reset-email-display input{cursor:not-allowed}.nested-form{display:grid;gap:14px}.primary,.secondary,.danger,.danger-soft{border:0;border-radius:13px;padding:11px 15px;font-weight:800;cursor:pointer;transition:transform .16s ease,opacity .16s ease,border-color .16s ease}.primary:hover,.secondary:hover,.danger:hover,.danger-soft:hover{transform:translateY(-1px)}.primary{background:linear-gradient(135deg,#f2d48b,#a8792f);color:#17110a}.primary:disabled{opacity:.48;cursor:not-allowed;transform:none}.secondary{background:rgba(196,164,100,.1);color:#e8cb82;border:1px solid rgba(196,164,100,.24)}.danger{background:#b91c1c;color:white}.danger:disabled{opacity:.45;cursor:not-allowed;transform:none}.danger-soft{background:rgba(244,63,94,.1);color:#fda4af;border:1px solid rgba(251,113,133,.22)}.muted{color:var(--profile-muted);font-size:13px}.avatar-card{min-height:440px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px}.avatar-card h2{margin-bottom:2px}.avatar-editor{display:grid;place-items:center}.avatar-editor img,.avatar-editor span{width:190px;height:190px;border-radius:44px;font-size:56px;box-shadow:0 20px 55px rgba(0,0,0,.26)}.avatar-identity{display:grid;gap:4px}.avatar-identity strong{font-size:20px;color:#f2eadb}.avatar-identity small{color:var(--profile-muted)}.avatar-file-button{position:relative;display:inline-flex;align-items:center;justify-content:center;border-radius:13px;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid var(--profile-border);color:#e8cb82;font-weight:800;cursor:pointer}.avatar-file-button input{position:absolute;inset:0;opacity:0;cursor:pointer}.divider{height:1px;background:var(--profile-border);margin:14px 0}.social-row{display:flex;align-items:center;justify-content:space-between;gap:16px;border:1px solid var(--profile-border);border-radius:18px;padding:18px;background:rgba(255,255,255,.025)}.social-row p{margin:4px 0 0;color:var(--profile-muted)}.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:20px}.stats div{background:rgba(255,255,255,.035);border:1px solid var(--profile-border);border-radius:18px;padding:16px}.stats strong{display:block;font-size:22px;color:#f2eadb}.stats span{font-size:12px;color:var(--profile-muted)}.timeline{display:grid;gap:10px;padding:0;margin:0;list-style:none}.timeline li{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--profile-border);padding:10px 0;color:#d4cfc8}.timeline time{color:var(--profile-muted);font-size:12px;white-space:nowrap}.confirm{margin:12px 0;padding:14px;border:1px solid rgba(251,113,133,.24);border-radius:16px;background:rgba(244,63,94,.08);display:grid;gap:10px}@media(max-width:850px){.profile-page{padding:18px}.profile-hero,.hero-user{display:block}.hero-user{min-width:0}.grid.two,.stats{grid-template-columns:1fr}.timeline li{display:block}.avatar-card{min-height:360px}.avatar-editor img,.avatar-editor span{width:160px;height:160px;border-radius:36px}}
`;
