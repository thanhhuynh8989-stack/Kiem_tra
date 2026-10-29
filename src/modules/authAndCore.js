import { appsScriptService } from '../services/appsScriptService.js';

// =========================================================================
// 1. QUẢN LÝ PHIÊN ĐĂNG NHẬP & SESSION TẬP TRUNG
// =========================================================================
export function getLoggedInUser() {
  try {
    const raw = sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function getLoggedInUsername() {
  const u = getLoggedInUser();
  if (!u) return '--';
  return String(u.username || u.studentCode || u.user || u.code || '--').trim();
}

export function getLoggedInRole() {
  const u = getLoggedInUser();
  if (!u) return 'GUEST';
  return String(u.role || 'GUEST').trim().toUpperCase();
}

export function saveUserSession(userData) {
  if (!userData) return;
  const cleanData = {
    username: String(userData.username || userData.studentCode || '').trim(),
    role: String(userData.role || 'STUDENT').trim().toUpperCase(),
    fullName: String(userData.fullName || userData.name || '').trim(),
    className: String(userData.className || userData.class || '').trim(),
    geminiApiKey: String(userData.geminiApiKey || '').trim()
  };
  
  sessionStorage.setItem('currentUser', JSON.stringify(cleanData));
  localStorage.setItem('currentUser', JSON.stringify(cleanData));
}

export function handleLogout() {
  if (confirm('Bạn có chắc chắn muốn ĐĂNG XUẤT khỏi hệ thống?')) {
    sessionStorage.removeItem('currentUser');
    sessionStorage.removeItem('userSession');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userSession');
    
    window.location.reload();
  }
}

// =========================================================================
// 2. XỬ LÝ ĐĂNG NHẬP THỐNG NHẤT
// =========================================================================
export async function handleLogin(username, password) {
  if (!username || !password) {
    alert('Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu!');
    return false;
  }

  showAppLoading('⏳ Đang xác thực tài khoản...');
  try {
    const res = await appsScriptService.request('LOGIN', { username, password });
    hideAppLoading();

    if (res.status === 'success' && res.user) {
      saveUserSession(res.user);
      alert(`🎉 Đăng nhập thành công! Chào mừng ${res.user.fullName || res.user.username}`);
      return true;
    } else {
      alert(`❌ Đăng nhập thất bại: ${res.message || 'Mật khẩu không đúng'}`);
      return false;
    }
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi kết nối Server: ${err.message}`);
    return false;
  }
}

// =========================================================================
// 3. THEO DÕI VI PHẠM QUY CHẾ THI (VIOLATION TRACKER)
// =========================================================================
window.violationCount = 0;
let isTrackingViolations = false;

function onVisibilityOrFocusChange() {
  if (!isTrackingViolations) return;

  if (document.hidden || !document.hasFocus()) {
    window.violationCount = (window.violationCount || 0) + 1;
    const count = window.violationCount;

    alert(
      `⚠️ CẢNH BÁO VI PHẠM QUY CHẾ THI! (Lần ${count}/3)\n` +
      `Bạn vừa rời khỏi màn hình làm bài thi.\n` +
      `Lưu ý: Rời màn hình quá 3 lần bài thi sẽ tự động nộp!`
    );

    if (count >= 3) {
      alert('❌ BẠN ĐÃ VI PHẠM DƯỚI 3 LẦN! Hệ thống tự động thu bài làm.');
      stopViolationTracking();
      if (typeof window.executeSubmitExam === 'function') {
        window.executeSubmitExam();
      }
    }
  }
}

export function startViolationTracking() {
  window.violationCount = 0;
  isTrackingViolations = true;

  window.removeEventListener('blur', onVisibilityOrFocusChange);
  document.removeEventListener('visibilitychange', onVisibilityOrFocusChange);

  window.addEventListener('blur', onVisibilityOrFocusChange);
  document.addEventListener('visibilitychange', onVisibilityOrFocusChange);
}

export function stopViolationTracking() {
  isTrackingViolations = false;
  window.removeEventListener('blur', onVisibilityOrFocusChange);
  document.removeEventListener('visibilitychange', onVisibilityOrFocusChange);
}

// =========================================================================
// 4. TIỆN ÍCH HIỂN THỊ LOADING & CHỐNG XSS
// =========================================================================
export function showAppLoading(msg = '⏳ Đang xử lý...') {
  let loader = document.getElementById('appGlobalLoader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'appGlobalLoader';
    loader.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.7); color: #fff; display: flex;
      flex-direction: column; justify-content: center; align-items: center;
      z-index: 99999; font-family: sans-serif; font-size: 15px; font-weight: 600;
      backdrop-filter: blur(2px);
    `;
    document.body.appendChild(loader);
  }
  loader.innerHTML = `
    <div style="border: 4px solid #f3f3f3; border-top: 4px solid #38bdf8; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 12px;"></div>
    <div>${escapeHtml(msg)}</div>
    <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
  `;
  loader.style.display = 'flex';
}

export function hideAppLoading() {
  const loader = document.getElementById('appGlobalLoader');
  if (loader) loader.style.display = 'none';
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.getLoggedInUser = getLoggedInUser;
window.getLoggedInUsername = getLoggedInUsername;
window.getLoggedInRole = getLoggedInRole;
window.handleLogout = handleLogout;
