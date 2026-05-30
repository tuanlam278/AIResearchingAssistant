import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    if (password.length < 6) { setError('Mật khẩu phải có ít nhất 6 ký tự.'); return; }
    setError('');
    setLoading(true);
    try {
      await api.register(email, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2200);
    } catch (err) {
      if (err.message === 'EMAIL_TAKEN') setError('Email này đã được sử dụng.');
      else setError('Có lỗi xảy ra khi đăng ký. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .auth-page {
          min-height: 100vh;
          background: #0f0d0a;
          background-image:
            radial-gradient(ellipse 70% 60% at 85% 10%, rgba(196,164,100,0.07) 0%, transparent 55%),
            radial-gradient(ellipse 50% 50% at 15% 90%, rgba(100,80,40,0.09) 0%, transparent 55%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          font-family: 'DM Sans', sans-serif;
          color: #d4cfc8;
        }

        .auth-card {
          width: 100%;
          max-width: 420px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          padding: 44px 40px 40px;
          backdrop-filter: blur(12px);
          animation: cardIn 0.5s cubic-bezier(.22,1,.36,1) both;
        }

        .auth-logo {
          text-align: center;
          margin-bottom: 32px;
        }
        .auth-logo-icon {
          width: 52px; height: 52px;
          background: linear-gradient(135deg, #c4a464, #8a6a30);
          border-radius: 14px;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 22px; margin-bottom: 16px;
          box-shadow: 0 4px 20px rgba(196,164,100,0.3);
        }
        .auth-logo h1 {
          font-family: 'Lora', Georgia, serif;
          font-size: 22px; font-weight: 600;
          color: #e8e0d0; margin-bottom: 4px;
        }
        .auth-logo p {
          font-size: 13px; color: #6a6050;
          font-style: italic; font-family: 'Lora', Georgia, serif;
        }

        .auth-divider {
          height: 1px; background: rgba(255,255,255,0.06);
          margin-bottom: 28px;
        }

        .auth-field { margin-bottom: 18px; }
        .auth-label {
          display: block; font-size: 12px; font-weight: 600;
          color: #8a8070; text-transform: uppercase;
          letter-spacing: 0.07em; margin-bottom: 8px;
        }
        .auth-input-wrap { position: relative; }
        .auth-input {
          width: 100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 10px; padding: 11px 14px;
          color: #d4cfc8; font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          outline: none; transition: border-color 0.2s, box-shadow 0.2s;
        }
        .auth-input::placeholder { color: #3a3020; }
        .auth-input:focus {
          border-color: rgba(196,164,100,0.4);
          box-shadow: 0 0 0 3px rgba(196,164,100,0.07);
        }
        .auth-input-pass { padding-right: 42px; }
        .auth-input-pass::-ms-reveal, .auth-input-pass::-ms-clear { display: none; }
        .auth-input-pass::-webkit-credentials-auto-fill-button { visibility: hidden; display: none !important; pointer-events: none; }
        .auth-toggle-pass {
          position: absolute; right: 12px; top: 50%;
          transform: translateY(-50%);
          background: none; border: none; cursor: pointer;
          color: #5a5040; font-size: 16px; padding: 2px;
          transition: color 0.2s;
        }
        .auth-toggle-pass:hover { color: #c4a464; }

        .auth-hint {
          font-size: 11px; color: #4a4030; margin-top: 5px;
        }

        .auth-error {
          display: flex; align-items: center; gap: 8px;
          background: rgba(200,80,80,0.08);
          border: 1px solid rgba(200,80,80,0.18);
          border-radius: 10px; padding: 10px 14px;
          font-size: 13px; color: #e07878;
          margin-bottom: 18px; animation: shake 0.35s ease;
        }

        .auth-success {
          display: flex; flex-direction: column;
          align-items: center; gap: 12px;
          text-align: center; padding: 20px 0 8px;
          animation: cardIn 0.4s ease both;
        }
        .auth-success-icon {
          width: 56px; height: 56px; border-radius: 50%;
          background: rgba(100,196,100,0.12);
          border: 2px solid rgba(100,196,100,0.25);
          display: flex; align-items: center; justify-content: center;
          font-size: 24px;
        }
        .auth-success h3 {
          font-family: 'Lora', Georgia, serif; font-size: 17px;
          font-weight: 600; color: #e8e0d0;
        }
        .auth-success p { font-size: 13px; color: #6a6050; line-height: 1.6; }

        .auth-btn {
          width: 100%; padding: 12px; border: none; border-radius: 10px;
          background: linear-gradient(135deg, #c4a464, #8a6a30);
          color: #1a1510; font-size: 14px; font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer; margin-top: 8px;
          transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 4px 16px rgba(196,164,100,0.25);
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .auth-btn:hover:not(:disabled) {
          opacity: 0.92; transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(196,164,100,0.35);
        }
        .auth-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

        .auth-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(26,21,16,0.3);
          border-top-color: #1a1510;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        .auth-footer {
          text-align: center; margin-top: 24px;
          font-size: 13px; color: #5a5040;
        }
        .auth-footer a {
          color: #c4a464; text-decoration: none;
          font-weight: 500; transition: color 0.2s;
        }
        .auth-footer a:hover { color: #e8c878; }

        @keyframes cardIn {
          from { opacity: 0; transform: translateY(20px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%,60% { transform: translateX(-6px); }
          40%,80% { transform: translateX(6px); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <div className="auth-logo-icon">✦</div>
            <h1>AI Research</h1>
            <p>Tạo tài khoản mới</p>
          </div>

          <div className="auth-divider" />

          {done ? (
            <div className="auth-success">
              <div className="auth-success-icon">✓</div>
              <h3>Đăng ký thành công!</h3>
              <p>Đang chuyển bạn đến trang đăng nhập...</p>
            </div>
          ) : (
            <>
              {error && <div className="auth-error">⚠ {error}</div>}

              <form onSubmit={handleRegister}>
                <div className="auth-field">
                  <label className="auth-label">Email</label>
                  <input
                    className="auth-input"
                    type="email" required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="ten@example.com"
                    autoComplete="email"
                  />
                </div>

                <div className="auth-field">
                  <label className="auth-label">Mật khẩu</label>
                  <div className="auth-input-wrap">
                    <input
                      className="auth-input auth-input-pass"
                      type={showPass ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Ít nhất 6 ký tự"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="auth-toggle-pass"
                      onClick={() => setShowPass(v => !v)}
                      tabIndex={-1}
                    >
                      {showPass ? '🙈' : '👁'}
                    </button>
                  </div>
                  <p className="auth-hint">Tối thiểu 6 ký tự</p>
                </div>

                <button type="submit" className="auth-btn" disabled={loading}>
                  {loading ? <span className="auth-spinner" /> : null}
                  {loading ? 'Đang tạo tài khoản...' : 'Tạo tài khoản'}
                </button>
              </form>
            </>
          )}

          <p className="auth-footer">
            Đã có tài khoản?{' '}
            <Link to="/login">Đăng nhập</Link>
          </p>
        </div>
      </div>
    </>
  );
}