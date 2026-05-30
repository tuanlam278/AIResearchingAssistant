import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';

const GENERIC_OTP_MESSAGE = 'Mã xác thực đã được tạo. Vui lòng kiểm tra email.';

export default function ForgotPasswordPage() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [passwords, setPasswords] = useState({ newPassword: '', confirmPassword: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const requestOtp = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.requestPasswordResetOtp(email);
      setNotice(GENERIC_OTP_MESSAGE);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Không thể yêu cầu mã xác thực.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (event) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(otp)) {
      setError('Vui lòng nhập OTP gồm 4 số.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.verifyPasswordResetOtp(email, otp);
      setNotice('Mã xác thực hợp lệ. Vui lòng đặt mật khẩu mới.');
      setStep(3);
    } catch (err) {
      setError(err.message || 'Mã xác thực không đúng hoặc đã hết hạn.');
    } finally {
      setLoading(false);
    }
  };

  const confirmReset = async (event) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(otp)) {
      setError('Vui lòng nhập OTP gồm 4 số.');
      return;
    }
    if (!passwords.newPassword || !passwords.confirmPassword) {
      setError('Vui lòng nhập đầy đủ mật khẩu mới.');
      return;
    }
    if (passwords.newPassword !== passwords.confirmPassword) {
      setError('Mật khẩu nhập lại không khớp.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const resp = await api.confirmPasswordResetWithOtp(email, otp, passwords.newPassword);
      setNotice(resp.message || 'Đã cập nhật mật khẩu.');
      setPasswords({ newPassword: '', confirmPassword: '' });
      setStep(1);
      setOtp('');
    } catch (err) {
      setError(err.message || 'Không thể cập nhật mật khẩu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="reset-page">
      <style>{styles}</style>
      <section className="reset-card">
        <div className="reset-logo">✦</div>
        <h1>Đặt lại mật khẩu</h1>
        <p className="muted">Nhận OTP 4 số qua email rồi đặt mật khẩu mới cho tài khoản email hoặc Google.</p>

        <div className="steps" aria-label="Tiến trình đặt lại mật khẩu">
          {[1, 2, 3].map((item) => <span key={item} className={step >= item ? 'active' : ''}>{item}</span>)}
        </div>

        {notice ? <div className="notice success">{notice}</div> : null}
        {error ? <div className="notice error">{error}</div> : null}

        {step === 1 ? (
          <form onSubmit={requestOtp}>
            <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ten@example.com" /></label>
            <button disabled={loading}>{loading ? 'Đang gửi...' : 'Yêu cầu mã xác thực'}</button>
          </form>
        ) : null}

        {step === 2 ? (
          <form onSubmit={verifyOtp}>
            <label>OTP 4 số<input inputMode="numeric" pattern="\d{4}" maxLength={4} required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" /></label>
            <button disabled={loading}>{loading ? 'Đang xác thực...' : 'Xác thực OTP'}</button>
            <button type="button" className="ghost" onClick={() => setStep(1)}>Đổi email</button>
          </form>
        ) : null}

        {step === 3 ? (
          <form onSubmit={confirmReset}>
            <label>Mật khẩu mới<input type="password" minLength={6} required value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} /></label>
            <label>Nhập lại mật khẩu mới<input type="password" minLength={6} required value={passwords.confirmPassword} onChange={(e) => setPasswords({ ...passwords, confirmPassword: e.target.value })} /></label>
            <button disabled={loading}>{loading ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}</button>
            <button type="button" className="ghost" onClick={() => setStep(2)}>Nhập lại OTP</button>
          </form>
        ) : null}

        <p className="footer"><Link to="/login">Quay lại đăng nhập</Link></p>
      </section>
    </main>
  );
}

const styles = `
.reset-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:#0f0d0a;color:#e7dfd0;font-family:'DM Sans',system-ui,sans-serif}.reset-card{width:min(460px,100%);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:34px;box-shadow:0 24px 70px rgba(0,0,0,.34)}.reset-logo{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#c4a464,#8a6a30);color:#17110a;font-weight:900;margin:0 auto 14px}.reset-card h1{text-align:center;font-family:'Lora',serif;margin:0 0 8px}.muted{text-align:center;color:#8a8070;font-size:14px;line-height:1.55}.steps{display:flex;justify-content:center;gap:10px;margin:20px 0}.steps span{width:30px;height:30px;border-radius:999px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.12);color:#8a8070}.steps span.active{background:rgba(196,164,100,.18);border-color:rgba(196,164,100,.42);color:#f5db98}.notice{border-radius:12px;padding:10px 12px;margin:12px 0;font-size:14px}.notice.success{background:rgba(34,197,94,.1);border:1px solid rgba(74,222,128,.24);color:#bbf7d0}.notice.error{background:rgba(244,63,94,.1);border:1px solid rgba(251,113,133,.24);color:#fecdd3}form{display:grid;gap:14px}label{display:grid;gap:7px;color:#cfc5b5;font-weight:700}input{border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:12px;background:rgba(10,8,6,.58);color:#e7dfd0;outline:none}input:focus{border-color:rgba(196,164,100,.45);box-shadow:0 0 0 3px rgba(196,164,100,.12)}button{border:0;border-radius:13px;padding:12px 15px;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#f2d48b,#a8792f);color:#17110a}button:disabled{opacity:.5;cursor:not-allowed}.ghost{background:transparent;color:#e8cb82;border:1px solid rgba(196,164,100,.24)}.footer{text-align:center;margin:20px 0 0}.footer a{color:#c4a464;text-decoration:none;font-weight:800}
`;
