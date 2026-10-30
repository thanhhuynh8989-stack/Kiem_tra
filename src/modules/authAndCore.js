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
window.isViolationTrackingActive = false;
window.isInternalDialogActive = false; // Cờ khóa tạm thời khi mở Hộp thoại thông báo nội bộ
let violationListener = null;

export function startViolationTracking() {
  window.violationCount = 0;
  window.isViolationTrackingActive = true;
  window.isInternalDialogActive = false;

  if (violationListener) {
    document.removeEventListener('visibilitychange', violationListener);
  }

  violationListener = function () {
    // Chỉ tính vi phạm khi: Đang bật giám sát + Trang bị ẩn/Chuyển tab + KHÔNG mở Dialog nội bộ
    if (window.isViolationTrackingActive && document.hidden && !window.isInternalDialogActive) {
      window.violationCount = (window.violationCount || 0) + 1;
      const count = window.violationCount;

      if (count >= 3) {
        window.isInternalDialogActive = true;
        alert('⚠️ BẠN ĐÃ VI PHẠM QUY CHẾ 3 LẦN! Hệ thống sẽ tự động nộp bài thi.');
        window.isInternalDialogActive = false;
        
        stopViolationTracking();
        if (typeof window.executeSubmitExam === 'function') {
          window.executeSubmitExam();
        }
      } else {
        window.isInternalDialogActive = true;
        alert(
          `⚠️ CẢNH BÁO VI PHẠM QUY CHẾ THI! (Lần ${count}/3)\n` +
          `Bạn vừa rời khỏi màn hình làm bài thi.\n` +
          `Lưu ý: Rời màn hình quá 3 lần bài thi sẽ tự động nộp!`
        );
        window.isInternalDialogActive = false;
      }
    }
  };

  document.addEventListener('visibilitychange', violationListener);
}

export function stopViolationTracking() {
  window.isViolationTrackingActive = false;
  window.isInternalDialogActive = false;
  if (violationListener) {
    document.removeEventListener('visibilitychange', violationListener);
    violationListener = null;
  }
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

// =========================================================================
// 5. CHỨC NĂNG ẨN / HIỆN MẬT KHẨU
// =========================================================================
export function togglePasswordVisibility(inputId, iconElement) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (iconElement) iconElement.innerText = '🙈';
  } else {
    input.type = 'password';
    if (iconElement) iconElement.innerText = '👁️';
  }
}

// =========================================================================
// 6. XỬ LÝ ĐĂNG KÝ GIẢNG VIÊN VÀ MÃ OTP
// =========================================================================
export function openRegisterLecturerModal() {
  const modal = document.getElementById('registerModal');
  if (modal) modal.style.display = 'flex';
}

export function closeRegisterModal() {
  const modal = document.getElementById('registerModal');
  if (modal) modal.style.display = 'none';
}

export async function sendRegisterOTP() {
  const username = document.getElementById('regUser')?.value.trim();
  const email = document.getElementById('regEmail')?.value.trim();

  if (!username || !email) {
    alert('Vui lòng nhập Tên đăng nhập và Email trước khi nhận OTP!');
    return;
  }

  showAppLoading('⏳ Đang gửi mã OTP đến email...');
  try {
    const res = await appsScriptService.request('SEND_OTP_REGISTER', { username, email });
    hideAppLoading();
    alert(res.message);
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

export async function submitLecturerRegistration() {
  const username = document.getElementById('regUser')?.value.trim();
  const password = document.getElementById('regPass')?.value.trim();
  const fullName = document.getElementById('regFullName')?.value.trim();
  const phone = document.getElementById('regPhone')?.value.trim();
  const email = document.getElementById('regEmail')?.value.trim();
  const otp = document.getElementById('regOTP')?.value.trim();

  showAppLoading('⏳ Đang xác thực và tạo tài khoản...');
  try {
    const res = await appsScriptService.request('REGISTER_LECTURER', {
      username, password, fullName, phone, email, otp
    });
    hideAppLoading();
    alert(res.message);
    closeRegisterModal();
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi đăng ký: ${err.message}`);
  }
}

// =========================================================================
// 7. XỬ LÝ QUÊN MẬT KHẨU VÀ OTP
// =========================================================================
export function openForgotPasswordModal() {
  const modal = document.getElementById('forgotModal');
  if (modal) modal.style.display = 'flex';
}

export function closeForgotModal() {
  const modal = document.getElementById('forgotModal');
  if (modal) modal.style.display = 'none';
}

let verifiedForgotUsername = '';

export async function sendForgotOTP() {
  const accountOrEmail = document.getElementById('forgotInput')?.value.trim();
  if (!accountOrEmail) {
    alert('Vui lòng nhập Tên đăng nhập hoặc Email!');
    return;
  }

  showAppLoading('⏳ Đang tìm tài khoản và gửi mã OTP...');
  try {
    const res = await appsScriptService.request('SEND_OTP_FORGOT', { accountOrEmail });
    hideAppLoading();
    verifiedForgotUsername = res.username || accountOrEmail;
    alert(res.message);
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

export async function submitResetPassword() {
  const otp = document.getElementById('forgotOTP')?.value.trim();
  const newPassword = document.getElementById('forgotNewPass')?.value.trim();

  if (!verifiedForgotUsername) {
    alert('Vui lòng gửi mã OTP trước!');
    return;
  }

  showAppLoading('⏳ Đang tiến hành đổi mật khẩu...');
  try {
    const res = await appsScriptService.request('RESET_PASSWORD_OTP', {
      username: verifiedForgotUsername,
      otp: otp,
      newPassword: newPassword
    });
    hideAppLoading();
    alert(res.message);
    closeForgotModal();
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

// Scope Window Binding
window.getLoggedInUser = getLoggedInUser;
window.getLoggedInUsername = getLoggedInUsername;
window.getLoggedInRole = getLoggedInRole;
window.handleLogout = handleLogout;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openRegisterLecturerModal = openRegisterLecturerModal;
window.closeRegisterModal = closeRegisterModal;
window.sendRegisterOTP = sendRegisterOTP;
window.submitLecturerRegistration = submitLecturerRegistration;
window.openForgotPasswordModal = openForgotPasswordModal;
window.closeForgotModal = closeForgotModal;
window.sendForgotOTP = sendForgotOTP;
window.submitResetPassword = submitResetPassword;
