import { appsScriptService } from '../services/appsScriptService.js';

// =========================================================================
// 1. TRẠNG THÁI TOÀN CỤC (GLOBAL STATE)
// =========================================================================
export let currentUser = null;
export let violationCount = 0;
export let isExamActive = false;

// =========================================================================
// 2. CHUẨN HÓA DỮ LIỆU & QUẢN LÝ PHIÊN (AUTH & SESSION)
// =========================================================================
export function normalizeUserData(raw) {
  if (!raw) return null;

  let obj = raw;
  if (obj.data && typeof obj.data === 'object') obj = obj.data;
  if (obj.user && typeof obj.user === 'object') obj = obj.user;
  if (obj.userData && typeof obj.userData === 'object') obj = obj.userData;
  if (obj.userInfo && typeof obj.userInfo === 'object') obj = obj.userInfo;
  if (Array.isArray(obj)) obj = obj[0] || {};

  let rawRole = obj.role || obj.Role || obj.ROLE || obj.userRole || raw.role || raw.Role || '';
  let normalizedRole = String(rawRole).toUpperCase().trim();

  let username = obj.username || obj.User || obj.user || raw.username || raw.User || '';
  if (typeof username === 'object') username = '';

  let fullName = obj.fullName || obj['Full name'] || obj.fullname || obj.Fullname || obj['full_name'] || obj.name || raw.fullName || '';
  if (typeof fullName === 'object') fullName = '';

  const knownRoles = ['ADMIN', 'LECTURER', 'STUDENT'];
  
  if (!fullName || knownRoles.includes(String(fullName).toUpperCase().trim())) {
    fullName = (username && !knownRoles.includes(String(username).toUpperCase().trim())) 
               ? username 
               : (normalizedRole === 'ADMIN' ? 'Quản trị hệ thống' : 
                  normalizedRole === 'LECTURER' ? 'Giảng viên' : 'Sinh viên');
  }

  if (!normalizedRole || !knownRoles.includes(normalizedRole)) {
    if (knownRoles.includes(String(obj.Role || raw.Role).toUpperCase().trim())) {
      normalizedRole = String(obj.Role || raw.Role).toUpperCase().trim();
    } else if (knownRoles.includes(String(username).toUpperCase().trim())) {
      normalizedRole = String(username).toUpperCase().trim();
    }
  }

  return {
    authenticated: raw.authenticated !== undefined ? raw.authenticated : true,
    username: String(username),
    fullName: String(fullName),
    role: normalizedRole
  };
}

export async function requestWithRetry(action, payload, retries = 2, delay = 1500) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await appsScriptService.request(action, payload);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

export async function handleLogin() {
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const loginBtn = document.getElementById('loginBtn');

  const username = usernameInput?.value.trim();
  const password = passwordInput?.value.trim();

  if (!username || !password) {
    return alert('Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu!');
  }

  const originalBtnText = loginBtn ? loginBtn.innerText : 'Đăng Nhập';
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.innerText = '⏳ Đang kết nối...';
  }

  try {
    const res = await requestWithRetry('AUTH_LECTURER', { username, password });

    sessionStorage.removeItem('currentUser');
    sessionStorage.removeItem('userSession');

    currentUser = normalizeUserData(res);

    if (currentUser && currentUser.role) {
      sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
      sessionStorage.setItem('userSession', JSON.stringify(currentUser));

      alert(`Đăng nhập thành công!\nXin chào ${currentUser.fullName}!`);

      if (currentUser.role === 'ADMIN' || currentUser.role === 'LECTURER') {
        showView(currentUser.role === 'ADMIN' ? 'adminView' : 'lecturerView');
      } else {
        showView('studentView');
        if (typeof window.handleLoadStudentDashboard === 'function') {
          window.handleLoadStudentDashboard();
        }
      }
    } else {
      alert(res.message || 'Tên đăng nhập hoặc mật khẩu không chính xác!');
    }
  } catch (err) {
    console.error('Login Error:', err);
    alert('Không thể kết nối đến Máy chủ! Vui lòng kiểm tra lại đường truyền mạng.');
  } finally {
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.innerText = originalBtnText;
    }
  }
}

export function handleLogout() {
  currentUser = null;
  sessionStorage.removeItem('currentUser');
  sessionStorage.removeItem('userSession');

  stopViolationTracking();

  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';

  showView('authView');
}

export function showView(viewId) {
  const targetView = document.getElementById(viewId);
  
  if (targetView) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    targetView.classList.add('active');
  }

  const userInfo = document.getElementById('userInfo');
  const userBadge = document.getElementById('userBadge');

  if (currentUser) {
    if (userInfo) userInfo.style.display = 'flex';
    
    const roleTitle = currentUser.role === 'ADMIN' ? 'Quản trị' : 
                      currentUser.role === 'LECTURER' ? 'Giảng viên' : 'Sinh viên';

    if (userBadge) {
      userBadge.textContent = `${currentUser.fullName} (${roleTitle})`;
    }

    if (viewId === 'lecturerView' && typeof window.handleLoadMyExams === 'function') {
      window.handleLoadMyExams();
    } else if (viewId === 'studentView' && typeof window.handleLoadStudentDashboard === 'function') {
      window.handleLoadStudentDashboard();
    }
  } else if (viewId === 'studentView') {
    if (userInfo) userInfo.style.display = 'flex';
    if (userBadge) userBadge.textContent = 'HỌC SINH / SINH VIÊN';
  } else {
    if (userInfo) userInfo.style.display = 'none';
  }
}

export function getLoggedInUsername() {
  const possibleKeys = ['currentUser', 'user', 'loggedInUser', 'username'];
  for (const key of possibleKeys) {
    const rawVal = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!rawVal) continue;
    try {
      const parsed = JSON.parse(rawVal);
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
      if (typeof parsed === 'object' && parsed !== null) {
        const name = parsed.username || parsed.user || parsed.fullName || parsed.studentCode;
        if (name && String(name).trim()) return String(name).trim();
      }
    } catch (e) {
      if (typeof rawVal === 'string' && rawVal.trim()) return rawVal.replace(/"/g, '').trim();
    }
  }
  return '';
}

// =========================================================================
// 3. GIÁM SÁT VI PHẠM (ANTI-CHEAT VIOLATION TRACKER)
// =========================================================================
export function startViolationTracking() {
  violationCount = 0;
  isExamActive = true;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', handleWindowBlur);
}

export function stopViolationTracking() {
  isExamActive = false;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('blur', handleWindowBlur);
}

function handleVisibilityChange() {
  if (document.hidden && isExamActive) processViolation();
}

function handleWindowBlur() {
  if (isExamActive) processViolation();
}

function processViolation() {
  if (!isExamActive) return;
  violationCount++;
  const max = 3;

  if (violationCount >= max) {
    alert(`⚠️ VI PHẠM QUY CHẾ (${violationCount}/${max}): Bạn đã rời khỏi màn hình thi!\nHệ thống TỰ ĐỘNG NỘP BÀI TỨC THỜI.`);
    stopViolationTracking();
    
    // Gọi hàm tự động nộp bài và dọn sạch bản nháp
    if (typeof window.executeSubmitExam === 'function') {
      window.executeSubmitExam();
    }
  } else if (violationCount === max - 1) {
    alert(`⚠️ CẢNH BÁO VI PHẠM (${violationCount}/${max}): Bạn vừa rời khỏi màn hình thi!\nNếu vi phạm thêm 1 lần nữa, bài thi sẽ bị TỰ ĐỘNG NỘP NGAY.`);
  } else {
    alert(`⚠️ VI PHẠM (${violationCount}/${max}): Vui lòng không chuyển tab hoặc rời khỏi màn hình!`);
  }
}

// =========================================================================
// 4. TIỆN ÍCH GIAO DIỆN VÀ OVERLAY LOADING
// =========================================================================
export function showAppLoading(message = 'Đang xử lý dữ liệu...') {
  let overlay = document.getElementById('globalAppLoadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'globalAppLoadingOverlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(4px);
      z-index: 99999; display: flex; flex-direction: column;
      justify-content: center; align-items: center; color: #ffffff;
    `;
    overlay.innerHTML = `
      <div style="background: #1e293b; padding: 24px 32px; border-radius: 12px; text-align: center; max-width: 360px; width: 90%;">
        <div style="width: 36px; height: 36px; border: 3px solid #38bdf8; border-top-color: transparent; border-radius: 50%; margin: 0 auto 12px auto; animation: spin 0.8s linear infinite;"></div>
        <div id="loadingOverlayMsg" style="font-weight: 600; font-size: 14px; color: #f8fafc;">${message}</div>
      </div>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(overlay);
  } else {
    const msgEl = document.getElementById('loadingOverlayMsg');
    if (msgEl) msgEl.innerHTML = message;
    overlay.style.display = 'flex';
  }
}

export function hideAppLoading() {
  const overlay = document.getElementById('globalAppLoadingOverlay');
  if (overlay) overlay.style.display = 'none';
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function togglePasswordVisibility() {
  const passInput = document.getElementById('loginPassword');
  const eyeBtn = document.getElementById('togglePasswordBtn');
  if (passInput) {
    passInput.type = passInput.type === 'password' ? 'text' : 'password';
    if (eyeBtn) eyeBtn.innerText = passInput.type === 'password' ? '👁️' : '🙈';
  }
}

// Bán biến/hàm ra Window để gọi trực tiếp từ HTML
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.showView = showView;
window.togglePasswordVisibility = togglePasswordVisibility;
window.showAppLoading = showAppLoading;
window.hideAppLoading = hideAppLoading;
