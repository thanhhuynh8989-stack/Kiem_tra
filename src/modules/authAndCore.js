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
      
      if (typeof window.switchTab === 'function') {
        const role = String(res.user.role || '').toUpperCase();
        if (role === 'STUDENT') {
          window.switchTab('tab-student-exams');
        } else {
          window.switchTab('tab-exams');
        }
      } else {
        window.location.reload();
      }
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

export async function submitLoginForm(event) {
  if (event && event.preventDefault) event.preventDefault();
  const userInput = document.getElementById('username') || document.getElementById('loginUser');
  const passInput = document.getElementById('password') || document.getElementById('loginPass');
  
  const username = userInput ? userInput.value.trim() : '';
  const password = passInput ? passInput.value.trim() : '';

  return await handleLogin(username, password);
}

// =========================================================================
// 3. THÔNG BÁO VI PHẠM BẰNG MODAL GIAO DIỆN (CHỐNG BỊ TRÌNH DUYỆT CHẶN)
// =========================================================================
export function showViolationModal(count, onConfirm) {
  let modal = document.getElementById('violationModalOverlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'violationModalOverlay';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.85); display: flex; justify-content: center;
      align-items: center; z-index: 999999; font-family: system-ui, -apple-system, sans-serif;
      backdrop-filter: blur(4px); padding: 16px; box-sizing: border-box;
    `;
    document.body.appendChild(modal);
  }

  const isFinal = count >= 3;
  modal.innerHTML = `
    <div style="background: #fff; border-radius: 12px; max-width: 420px; width: 100%; padding: 24px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3); border-top: 6px solid ${isFinal ? '#dc2626' : '#f59e0b'};">
      <div style="font-size: 48px; margin-bottom: 12px;">${isFinal ? '❌' : '⚠️'}</div>
      <h3 style="margin: 0 0 8px 0; color: ${isFinal ? '#dc2626' : '#d97706'}; font-size: 18px; font-weight: 700;">
        ${isFinal ? 'VI PHẠM QUY CHẾ BÀI THI!' : `CẢNH BÁO VI PHẠM (Lần ${count}/3)`}
      </h3>
      <p style="margin: 0 0 20px 0; color: #475569; font-size: 14px; line-height: 1.5;">
        ${isFinal 
          ? 'Bạn đã rời màn hình quá 3 lần. Hệ thống sẽ <strong>tự động nộp bài thi</strong> của bạn ngay bây giờ!' 
          : 'Hệ thống ghi nhận bạn vừa rời khỏi màn hình làm bài.<br><strong style="color:#dc2626;">Lưu ý: Rời màn hình quá 3 lần bài thi sẽ tự động nộp!</strong>'}
      </p>
      <button id="violationModalBtn" style="background: ${isFinal ? '#dc2626' : '#2563eb'}; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; width: 100%;">
        ${isFinal ? 'Tự Động Nộp Bài' : 'Tôi Đã Hiểu & Tiếp Tục Làm Bài'}
      </button>
    </div>
  `;
  modal.style.display = 'flex';

  document.getElementById('violationModalBtn').onclick = function () {
    modal.style.display = 'none';
    window.isInternalDialogActive = false;
    if (typeof onConfirm === 'function') {
      onConfirm();
    }
  };
}

// =========================================================================
// 4. THEO DÕI VI PHẠM QUY CHẾ THI (VIOLATION TRACKER ENGINE - SỬA LỖI ĐẢO VỊ TRÍ)
// =========================================================================
window.violationCount = 0;
window.isViolationTrackingActive = false;
window.isInternalDialogActive = false;

let leftTimestamp = 0;
let visibilityHandler = null;
let blurHandler = null;
let pageHideHandler = null;
let isProcessingViolation = false;

export function startViolationTracking(initialCount = 0) {
  // 1. HỦY TẤT CẢ LISTENER CŨ TRƯỚC KHI THIẾT LẬP MỚI
  stopViolationTracking();

  // 2. KHỞI TẠO CÁC BIẾN THEO DÕI (ĐẶT SAU STOP)
  window.violationCount = Number(initialCount) || 0;
  window.isViolationTrackingActive = true;
  window.isInternalDialogActive = false;
  leftTimestamp = 0;
  isProcessingViolation = false;

  const handleViolationTrigger = () => {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive || isProcessingViolation) return;
    
    isProcessingViolation = true;
    triggerViolationNotification();
    setTimeout(() => { isProcessingViolation = false; }, 800);
  };

  visibilityHandler = function () {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive) return;

    if (document.hidden) {
      leftTimestamp = Date.now();
      handleViolationTrigger();
    } else if (leftTimestamp > 0) {
      leftTimestamp = 0;
      handleViolationTrigger();
    }
  };

  blurHandler = function () {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive) return;
    handleViolationTrigger();
  };

  pageHideHandler = function () {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive) return;
    leftTimestamp = Date.now();
    handleViolationTrigger();
  };

  document.addEventListener('visibilitychange', visibilityHandler);
  window.addEventListener('blur', blurHandler);
  window.addEventListener('pagehide', pageHideHandler);
}

function triggerViolationNotification() {
  window.violationCount = (window.violationCount || 0) + 1;
  const count = window.violationCount;

  window.isInternalDialogActive = true;

  showViolationModal(count, () => {
    if (count >= 3) {
      stopViolationTracking();
      if (typeof window.executeSubmitExam === 'function') {
        window.executeSubmitExam();
      }
    }
  });
}

export function stopViolationTracking() {
  window.isViolationTrackingActive = false;
  window.isInternalDialogActive = false;
  leftTimestamp = 0;
  isProcessingViolation = false;

  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (blurHandler) {
    window.removeEventListener('blur', blurHandler);
    blurHandler = null;
  }
  if (pageHideHandler) {
    window.removeEventListener('pagehide', pageHideHandler);
    pageHideHandler = null;
  }
}

// =========================================================================
// 5. TIỆN ÍCH HIỂN THỊ LOADING & CHỐNG XSS
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
// 6. CHỨC NĂNG ẨN / HIỆN MẬT KHẨU
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
// 7. XỬ LÝ ĐĂNG KÝ GIẢNG VIÊN VÀ MÃ OTP
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
// 8. XỬ LÝ QUÊN MẬT KHẨU VÀ OTP
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

// Global Window Bindings
window.getLoggedInUser = getLoggedInUser;
window.getLoggedInUsername = getLoggedInUsername;
window.getLoggedInRole = getLoggedInRole;
window.handleLogout = handleLogout;
window.handleLogin = handleLogin;
window.submitLoginForm = submitLoginForm;
window.startViolationTracking = startViolationTracking;
window.stopViolationTracking = stopViolationTracking;
window.showViolationModal = showViolationModal;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openRegisterLecturerModal = openRegisterLecturerModal;
window.closeRegisterModal = closeRegisterModal;
window.sendRegisterOTP = sendRegisterOTP;
window.submitLecturerRegistration = submitLecturerRegistration;
window.openForgotPasswordModal = openForgotPasswordModal;
window.closeForgotModal = closeForgotModal;
window.sendForgotOTP = sendForgotOTP;
window.submitResetPassword = submitResetPassword;
