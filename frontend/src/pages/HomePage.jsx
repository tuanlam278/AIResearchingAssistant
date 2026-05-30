import { BookOpen, GitCompare, Library, SearchCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const FEATURES = [
  {
    title: 'Không gian Nghiên cứu',
    description: 'Tổ chức notebook, tải tài liệu riêng và hỏi đáp theo nguồn trong một workspace tập trung.',
    icon: BookOpen,
    route: '/notebook',
  },
  {
    title: 'Kính lúp Học thuật',
    description: 'Đọc tài liệu, bôi chọn ngữ cảnh, chụp vùng nội dung và ghi chú Markdown nhanh.',
    icon: SearchCheck,
    route: '/academic-lens',
  },
  {
    title: 'So sánh Tương quan',
    description: 'Đối chiếu hai tài liệu, phát hiện điểm giống/khác và tổng hợp nhận định học thuật.',
    icon: GitCompare,
    route: '/cross-analysis',
  },
  {
    title: 'Thư viện Hệ thống',
    description: 'Tra cứu kho tài liệu chuẩn hóa, bookmark và tái sử dụng nguồn tri thức cho nghiên cứu.',
    icon: Library,
    route: '/system-library',
  },
];

const STYLES = `
  .home-page { min-height:100vh; padding:32px clamp(18px,4vw,56px) 64px; background:radial-gradient(ellipse at 38% 0%, rgba(196,164,100,.16), transparent 44%), #0f0d0a; color:#e8dfd0; font-family:'Lora', Georgia, serif; }
  .home-hero { border:1px solid rgba(255,255,255,.08); border-radius:30px; padding:clamp(24px,4vw,42px); background:radial-gradient(circle at 88% 18%, rgba(112,88,42,.34), transparent 30%), linear-gradient(135deg, rgba(255,255,255,.065), rgba(255,255,255,.025)); box-shadow:0 28px 90px rgba(0,0,0,.32); }
  .home-eyebrow { color:#d8bd77; font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.1em; }
  .home-hero h1 { margin:12px 0 10px; color:#f3ebdc; font-size:clamp(34px,5vw,58px); line-height:1.04; }
  .home-hero p { max-width:850px; color:#a99e8e; line-height:1.75; font-size:15px; }
  .home-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; margin-top:22px; }
  .home-card { text-align:left; min-height:210px; border:1px solid rgba(255,255,255,.08); border-radius:24px; background:rgba(255,255,255,.035); color:inherit; padding:22px; cursor:pointer; display:flex; flex-direction:column; gap:14px; transition:transform .18s ease, border-color .18s ease, background .18s ease, box-shadow .18s ease; }
  .home-card:hover, .home-card:focus-visible { transform:translateY(-2px); border-color:rgba(196,164,100,.32); background:rgba(196,164,100,.055); box-shadow:0 20px 70px rgba(0,0,0,.28); outline:none; }
  .home-card__icon { width:52px; height:52px; border-radius:16px; display:grid; place-items:center; color:#f2d48b; background:rgba(196,164,100,.12); border:1px solid rgba(196,164,100,.2); }
  .home-card h2 { margin:0; color:#f3ebdc; font-size:21px; }
  .home-card p { margin:0; color:#9f9484; line-height:1.65; font-size:13px; flex:1; }
  .home-card__open { width:max-content; display:inline-flex; align-items:center; gap:8px; border-radius:999px; padding:8px 12px; background:linear-gradient(135deg,#d4b66f,#8a6a30); color:#18130d; font-size:12px; font-weight:900; }
  @media (max-width:760px) { .home-grid { grid-template-columns:1fr; } .home-card { min-height:180px; } }
`;

export default function HomePage() {
  const navigate = useNavigate();
  return (
    <div className="home-page">
      <style>{STYLES}</style>
      <section className="home-hero">
        <span className="home-eyebrow">Post-login homepage</span>
        <h1>AI Researching Assistant</h1>
        <p>Trợ lý nghiên cứu học thuật giúp bạn đọc tài liệu, hỏi đáp theo nguồn, so sánh tài liệu và ghi chú tri thức nhanh hơn.</p>
      </section>
      <section className="home-grid" aria-label="Tính năng chính">
        {FEATURES.map(({ title, description, icon: Icon, route }) => (
          <button key={route} type="button" className="home-card" onClick={() => navigate(route)} aria-label={`Mở ${title}`}>
            <span className="home-card__icon"><Icon size={25} /></span>
            <h2>{title}</h2>
            <p>{description}</p>
            <span className="home-card__open">Mở →</span>
          </button>
        ))}
      </section>
    </div>
  );
}
