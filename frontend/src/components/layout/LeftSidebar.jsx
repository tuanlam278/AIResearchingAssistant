import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Library,
  ChevronLeft,
  LogOut,
  Sparkles,
  ShieldCheck,
  GitCompare,
  SearchCheck,
  UserCircle,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";

const NAV_ITEMS = [
  {
    to: "/notebook",
    icon: BookOpen,
    label: "Không gian Nghiên cứu",
    description: "Tải tài liệu của bạn lên và hỏi AI dựa trên tài liệu riêng.",
  },
  {
    to: "/academic-lens",
    icon: SearchCheck,
    label: "Kính lúp Học thuật",
    description:
      "Đọc, đánh dấu, chụp vùng nội dung và hỏi AI trực tiếp trên tài liệu.",
  },
  {
    to: "/cross-analysis",
    icon: GitCompare,
    label: "Đối chiếu Tài liệu",
    description:
      "Đối chiếu nội dung hai tài liệu với bằng chứng theo từng tiêu chí.",
  },
  {
    to: "/system-library",
    icon: Library,
    label: "Thư viện Cộng đồng",
    description:
      "Kho tài liệu cộng đồng được chuẩn hóa, tìm kiếm ngữ nghĩa và sẵn sàng cho RAG.",
  },
];

const STYLES = `
  .left-sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 60;
    width: 280px;
    background:
      radial-gradient(circle at 30% 0%, rgba(196,164,100,0.14), transparent 28%),
      linear-gradient(180deg, rgba(24,21,16,0.98), rgba(14,12,9,0.98));
    border-right: 1px solid rgba(255,255,255,0.08);
    box-shadow: 22px 0 60px rgba(0,0,0,0.35);
    transition: width 0.2s ease, transform 0.22s ease;
    font-family: 'Lora', Georgia, serif;
    
    /* QUAN TRỌNG: Gốc rễ để hiển thị tràn viền */
    overflow: visible !important; 
  }
  
  /* Khối bọc nội dung bên trong để xử lý cuộn độc lập */
  .left-sidebar__wrapper {
    width: 100%;
    height: 100%;
    padding: 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    overflow-y: auto;
    overflow-x: hidden;
  }
  
  .left-sidebar.is-collapsed { width: 92px; }
  .left-sidebar__brand { display: flex; align-items: center; gap: 12px; padding: 4px 8px 12px; min-height: 54px; }
  .left-sidebar__brand-home { display:flex; align-items:center; gap:12px; min-width:0; border:0; background:transparent; color:inherit; padding:0; cursor:pointer; text-align:left; }
  .left-sidebar__brand-home:hover .left-sidebar__mark { box-shadow:0 12px 34px rgba(196,164,100,.38); }
  .left-sidebar__brand-home:focus-visible { outline:2px solid rgba(242,212,139,.65); outline-offset:4px; border-radius:16px; }
  .left-sidebar__mark {
    width: 42px; height: 42px; border-radius: 14px;
    display: grid; place-items: center;
    color: #1a1510;
    background: linear-gradient(135deg, #f2d48b, #a8792f);
    box-shadow: 0 10px 30px rgba(196,164,100,0.28);
    flex-shrink: 0; overflow:hidden;
  }
  .left-sidebar__avatar img { width:100%; height:100%; object-fit:cover; display:block; }
  .left-sidebar__title { min-width: 0; }
  .left-sidebar__title strong { display: block; color: #f2eadb; font-family: 'Lora', Georgia, serif; font-size: 17px; line-height: 1.15; }
  .left-sidebar__title span { display: block; color: #8a8070; font-size: 12px; margin-top: 3px; }
  
  /* ĐỊNH VỊ NÚT: Đặt tuyệt đối so với toàn bộ .left-sidebar */
  .left-sidebar__collapse {
    position: absolute;
    right: -12px; /* Đẩy lồi ra ngoài biên phải một nửa nút */
    top: 32px;    /* Căn vị trí chiều dọc khớp với thanh Brand */
    width: 24px; 
    height: 24px; 
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px; 
    color: #8a8070; 
    background: #1b1711; /* Màu nền tối cố định */
    cursor: pointer;
    display: inline-flex; 
    align-items: center; 
    justify-content: center;
    z-index: 999; /* Đảm bảo luôn nằm trên cùng */
    transition: transform 0.2s ease, right 0.2s ease;
    box-shadow: 4px 0 10px rgba(0,0,0,0.5);
  }
  .left-sidebar__collapse:hover { color: #d6c28b; border-color: rgba(196,164,100,0.35); }
  
  /* Xoay mũi tên thành ">" khi đóng */
  .left-sidebar.is-collapsed .left-sidebar__collapse { 
    transform: rotate(180deg); 
  }

  .left-sidebar.is-collapsed .left-sidebar__title, .left-sidebar.is-collapsed .left-sidebar__item-text, .left-sidebar.is-collapsed .left-sidebar__user-meta, .left-sidebar.is-collapsed .left-sidebar__logout span, .left-sidebar.is-collapsed .left-sidebar__section-label { display: none; }
  .left-sidebar.is-collapsed .left-sidebar__brand, .left-sidebar.is-collapsed .left-sidebar__brand-home, .left-sidebar.is-collapsed .left-sidebar__nav-link, .left-sidebar.is-collapsed .left-sidebar__user { justify-content: center; }
  .left-sidebar.is-collapsed .left-sidebar__brand { padding-left: 0; padding-right: 0; }
  .left-sidebar.is-collapsed .left-sidebar__nav-link { align-items: center; padding-left: 0; padding-right: 0; }
  .left-sidebar.is-collapsed .left-sidebar__nav-link svg { margin-top: 0; }
  
  .left-sidebar__section-label { color: #5a5040; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; padding: 0 10px; display: flex; justify-content: center; }
  .left-sidebar__nav { display: flex; flex-direction: column; gap: 8px; }
  .left-sidebar__nav-link {
    position: relative;
    display: flex; align-items: center; justify-content: center; gap: 12px;
    min-height: 58px;
    padding: 12px;
    text-decoration: none;
    color: #9b927f;
    border-radius: 16px;
    border: 1px solid transparent;
    background: transparent;
    transition: background 0.18s, color 0.18s, border-color 0.18s, transform 0.18s;
  }
  .left-sidebar__nav-link:hover { color: #efe6d4; background: rgba(255,255,255,0.045); border-color: rgba(255,255,255,0.08); transform: translateY(-1px); }
  .left-sidebar__nav-link.is-active {
    color: #f5db98;
    background: linear-gradient(135deg, rgba(196,164,100,0.16), rgba(196,164,100,0.055));
    border-color: rgba(196,164,100,0.28);
    box-shadow: inset 3px 0 0 rgba(242,212,139,0.85);
  }
  .left-sidebar__nav-link svg { flex-shrink: 0; margin-top: 2px; }
  .left-sidebar__label { display: block; color: inherit; font-weight: 700; font-size: 14px; line-height: 1.2; }
  .left-sidebar__description { display: block; margin-top: 4px; color: #6d6354; font-size: 11px; line-height: 1.35; }
  .left-sidebar__nav-link.is-active .left-sidebar__description { color: #a99562; }
  .left-sidebar__spacer { flex: 1; }
  .left-sidebar__user {
    display: flex; align-items: center; gap: 10px;
    padding: 12px;
    border-radius: 16px;
    background: rgba(255,255,255,0.035);
    border: 1px solid rgba(255,255,255,0.07);
  }
  .left-sidebar__profile-link { width:100%; text-align:left; cursor:pointer; color:inherit; }
  .left-sidebar__profile-link:hover { border-color: rgba(196,164,100,0.22); background: rgba(196,164,100,0.06); }
  .left-sidebar__avatar {
    width: 38px; height: 38px; border-radius: 13px;
    display: grid; place-items: center;
    background: rgba(196,164,100,0.12);
    border: 1px solid rgba(196,164,100,0.18);
    color: #e8cb82; font-weight: 700;
    flex-shrink: 0; overflow:hidden;
  }
  .left-sidebar__avatar img { width:100%; height:100%; object-fit:cover; display:block; }
  .left-sidebar__user-meta { min-width: 0; }
  .left-sidebar__user-meta strong { display: block; color: #efe6d4; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .left-sidebar__user-meta span { display: flex; align-items:center; gap:4px; color: #6d6354; font-size: 11px; margin-top: 2px; }
  .left-sidebar__logout {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; min-height: 40px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.07);
    background: transparent;
    color: #8a8070;
    cursor: pointer;
  }
  .left-sidebar__logout:hover { color: #e07878; background: rgba(224,120,120,0.07); border-color: rgba(224,120,120,0.18); }
  
  @media (max-width: 900px) {
    .left-sidebar, .left-sidebar.is-collapsed { width: min(320px, calc(100vw - 44px)); transform: translateX(-105%); }
    .left-sidebar.is-mobile-open { transform: translateX(0); }
    .left-sidebar.is-collapsed .left-sidebar__title, .left-sidebar.is-collapsed .left-sidebar__item-text, .left-sidebar.is-collapsed .left-sidebar__user-meta, .left-sidebar.is-collapsed .left-sidebar__logout span { display: block; }
    .left-sidebar.is-collapsed .left-sidebar__brand, .left-sidebar.is-collapsed .left-sidebar__nav-link { justify-content: flex-start; }
    .left-sidebar__collapse { display: none; }
  }
`;

export default function LeftSidebar({
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onCloseMobile,
}) {
  const { token, user, logoutContext } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const email = user?.email || "researcher@local";
  const initial = (user?.name || email).trim().charAt(0).toUpperCase();
  const rememberedWorkspacePath = localStorage.getItem("researchWorkspace:lastPath") || "/notebook";
  const rememberedAcademicLensPath = localStorage.getItem("academicLens:lastPath") || "/academic-lens";
  const navItems =
    user?.role === "admin"
      ? [
          ...NAV_ITEMS,
          {
            to: "/admin",
            icon: ShieldCheck,
            label: "Quản trị",
            description: "Import và quản lý tài liệu Thư viện Cộng đồng.",
          },
        ]
      : NAV_ITEMS;
  const resolvedNavItems = navItems.map((item) => {
    if (item.to === "/notebook") return { ...item, to: rememberedWorkspacePath };
    if (item.to === "/academic-lens") return { ...item, to: rememberedAcademicLensPath };
    return item;
  });

  const isWorkspaceActive = location.pathname === "/notebook" || location.pathname.startsWith("/notebooks/") || location.pathname.startsWith("/research/");
  const isAcademicLensActive = location.pathname.startsWith("/academic-lens");

  const handleLogout = async () => {
    try {
      await api.logout(token);
    } catch {}
    logoutContext();
    navigate("/login");
  };

  return (
    <aside
      className={`left-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
    >
      <style>{STYLES}</style>

      {/* NÚT BẤM ĐƯỢC ĐƯA RA NGOÀI KHỐI CUỘN WRAPPER */}
      <button
        type="button"
        className="left-sidebar__collapse"
        onClick={onToggleCollapsed}
        aria-label="Thu gọn sidebar"
      >
        <ChevronLeft size={14} />
      </button>

      {/* KHỐI CON CHỨA TOÀN BỘ NỘI DUNG VÀ XỬ LÝ CUỘN (SCROLL) */}
      <div className="left-sidebar__wrapper app-scrollbar">
        <div className="left-sidebar__brand">
          <button
            type="button"
            className="left-sidebar__brand-home"
            onClick={() => {
              navigate("/home");
              onCloseMobile?.();
            }}
            aria-label="Về trang chủ"
          >
            <div className="left-sidebar__mark">
              <Sparkles size={20} />
            </div>
            <div className="left-sidebar__title">
              <strong>AI Research</strong>
              <span>Assistant workspace</span>
            </div>
          </button>
        </div>

        <div className="left-sidebar__section-label">Chế độ làm việc</div>
        <nav
          className="left-sidebar__nav"
          aria-label="Điều hướng chế độ nghiên cứu"
        >
          {resolvedNavItems.map(({ to, icon: Icon, label, description }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/notebook"}
              className={({ isActive }) => {
                const active = isActive || (label === "Không gian Nghiên cứu" && isWorkspaceActive) || (label === "Kính lúp Học thuật" && isAcademicLensActive);
                return `left-sidebar__nav-link ${active ? "is-active" : ""}`;
              }}
              title={collapsed ? `${label} — ${description}` : undefined}
              onClick={onCloseMobile}
            >
              <Icon size={20} />
              <span className="left-sidebar__item-text">
                <span className="left-sidebar__label">{label}</span>
                <span className="left-sidebar__description">{description}</span>
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="left-sidebar__spacer" />

        <button
          type="button"
          className="left-sidebar__user left-sidebar__profile-link"
          title={collapsed ? email : "Mở hồ sơ cá nhân"}
          onClick={() => {
            navigate("/profile");
            onCloseMobile?.();
          }}
        >
          <div className="left-sidebar__avatar">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="Avatar" />
            ) : (
              initial
            )}
          </div>
          <div className="left-sidebar__user-meta">
            <strong>{user?.name || email}</strong>
            <span>
              <UserCircle size={12} /> Hồ sơ cá nhân ·{" "}
              {user?.role === "admin" ? "Admin" : "User"}
            </span>
          </div>
        </button>

        <button
          type="button"
          className="left-sidebar__logout"
          onClick={handleLogout}
        >
          <LogOut size={16} /> <span>Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}
