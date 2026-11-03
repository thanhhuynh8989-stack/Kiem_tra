import { appsScriptService } from '../services/appsScriptService.js';

import { saveExamDraftToLocal } from './offlineExamEngine.js';

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
// =========================================================================
// 1. GIAO DIỆN MODAL CẢNH BÁO VI PHẠM (ĐÃ SỬA LỖI TRUYỀN THAM SỐ & CSS MOBILE)
// =========================================================================
export function showViolationModal(count, reason, onConfirm) {
  // Chuẩn hóa tham số (Hỗ trợ gọi 2 hoặc 3 tham số linh hoạt)
  if (typeof reason === 'function') {
    onConfirm = reason;
    reason = 'Vi phạm quy chế thi!';
  }

  let modal = document.getElementById('violationModalOverlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'violationModalOverlay';
    modal.style.cssText = `
      position: fixed; inset: 0; width: 100%; height: 100%;
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
      <p style="margin: 0 0 12px 0; color: #475569; font-size: 14px; line-height: 1.5;">
        ${isFinal 
          ? 'Bạn đã rời màn hình quá 3 lần. Hệ thống sẽ <strong>tự động nộp bài thi</strong> của bạn ngay bây giờ!' 
          : 'Hệ thống ghi nhận bạn vừa rời khỏi màn hình làm bài.<br><strong style="color:#dc2626;">Lưu ý: Rời màn hình quá 3 lần bài thi sẽ tự động nộp!</strong>'}
      </p>
      ${reason ? `<div style="font-size: 12px; color: #64748b; background: #f1f5f9; padding: 6px 10px; border-radius: 6px; margin-bottom: 16px;">Lý do: ${escapeHtml(reason)}</div>` : ''}
      <button id="violationModalBtn" type="button" style="background: ${isFinal ? '#dc2626' : '#2563eb'}; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; width: 100%; -webkit-tap-highlight-color: transparent;">
        ${isFinal ? 'Tự Động Nộp Bài' : 'Tôi Đã Hiểu & Tiếp Tục Làm Bài'}
      </button>
    </div>
  `;
  modal.style.display = 'flex';

  const btn = document.getElementById('violationModalBtn');
  btn.onclick = function () {
    modal.style.display = 'none';
    window.isInternalDialogActive = false;
    if (typeof onConfirm === 'function') {
      onConfirm();
    }
  };
}

// =========================================================================
// 2. BỘ THEO DÕI VI PHẠM TỐI ƯU CHO CẢ MOBILE VÀ DESKTOP
// =========================================================================
window.violationCount = 0;
window.isViolationTrackingActive = false;
window.isInternalDialogActive = false;

let visibilityHandler = null;
let blurHandler = null;
let focusHandler = null;
let pageHideHandler = null;

let blurTimer = null;
let countdownInterval = null;
let focusCheckInterval = null;
let isProcessingViolation = false;
const GRACE_PERIOD_MS = 3000;

export function isZaloWebView() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  return /Zalo/i.test(ua);
}

export function renderZaloBlockerScreen() {
  const mainContent = document.getElementById('mainContentArea');
  if (!mainContent) return;

  mainContent.innerHTML = `
    <div style="max-width:480px; margin:40px auto; padding:24px; background:#fff; border-radius:12px; border:2px solid #ef4444; text-align:center; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
      <div style="font-size:48px; margin-bottom:12px;">⚠️</div>
      <h3 style="color:#991b1b; margin-bottom:12px; font-size:18px;">Yêu Cầu Mở Bằng Trình Duyệt</h3>
      <p style="font-size:14px; color:#334155; line-height:1.6; margin-bottom:16px;">
        Để đảm bảo tính minh bạch và tính năng chống gian lận hoạt động chính xác, bài thi <strong>không thể làm trực tiếp bên trong ứng dụng Zalo</strong>.
      </p>
      
      <div style="background:#f8fafc; padding:14px; border-radius:8px; border:1px dashed #cbd5e1; text-align:left; font-size:13px; color:#475569; margin-bottom:20px;">
        <strong>📌 Hướng dẫn mở bằng trình duyệt:</strong>
        <ol style="margin-left:18px; margin-top:8px; line-height:1.6;">
          <li>Bấm vào biểu tượng <strong>3 dấu chấm (⋮)</strong> hoặc <strong>(•••)</strong> ở góc trên bên phải màn hình.</li>
          <li>Chọn <strong>"Mở bằng trình duyệt"</strong> (Chrome trên Android hoặc Safari trên iPhone).</li>
        </ol>
      </div>

      <button type="button" onclick="location.reload()" style="background:#2563eb; color:#fff; border:none; padding:10px 20px; border-radius:6px; font-weight:600; cursor:pointer; font-size:14px;">
        🔄 Thử Tải Lại Trang
      </button>
    </div>
  `;
}

function showGracePeriodBanner(secondsRemaining) {
  let banner = document.getElementById('gracePeriodWarningBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'gracePeriodWarningBanner';
    banner.style.cssText = `
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      z-index: 999999; background: #fef08a; border: 2px solid #eab308; color: #854d0e;
      padding: 12px 20px; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      font-size: 14px; font-weight: 600; text-align: center; max-width: 90%; width: 520px;
      box-sizing: border-box;
    `;
    document.body.appendChild(banner);
  }

  banner.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:center; gap:10px;">
      <span style="font-size:20px;">⚠️</span>
      <div style="text-align:left;">
        <div style="color:#a16207; font-weight:700; font-size:14px;">PHÁT HIỆN RỜI CỬA SỔ BÀI THI!</div>
        <div style="font-size:12px; font-weight:500; margin-top:2px;">
          Vui lòng <strong>chạm vào màn hình bài thi</strong> để tiếp tục!
        </div>
      </div>
      <div style="background:#eab308; color:#fff; font-size:16px; font-weight:800; padding:4px 10px; border-radius:50px; min-width:36px; text-align:center; margin-left:auto;">
        ${secondsRemaining}s
      </div>
    </div>
  `;
  banner.style.style.display = 'block';
}

function hideGracePeriodBanner() {
  const banner = document.getElementById('gracePeriodWarningBanner');
  if (banner) banner.style.display = 'none';
}

function clearGracePeriodTimers() {
  if (blurTimer) {
    clearTimeout(blurTimer);
    blurTimer = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function startGracePeriodCountdown(reason = 'Mất tiêu điểm cửa sổ làm bài quá 3 giây!') {
  if (blurTimer || !window.isViolationTrackingActive || window.isInternalDialogActive || document.hidden) return;

  let secondsLeft = Math.ceil(GRACE_PERIOD_MS / 1000);
  showGracePeriodBanner(secondsLeft);

  countdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft > 0) {
      showGracePeriodBanner(secondsLeft);
    } else {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }, 1000);

  blurTimer = setTimeout(() => {
    clearGracePeriodTimers();
    hideGracePeriodBanner();

    if (window.isViolationTrackingActive && !window.isInternalDialogActive) {
      triggerViolationNotification(reason);
    }
  }, GRACE_PERIOD_MS);
}

export function startViolationTracking(initialCount = 0) {
  if (isZaloWebView()) {
    renderZaloBlockerScreen();
    return;
  }

  stopViolationTracking();

  window.violationCount = Number(initialCount) || 0;
  window.isViolationTrackingActive = true;
  window.isInternalDialogActive = false;
  isProcessingViolation = false;

  // 1. CHUYỂN TAB HOẶC ĐÓNG BROWSER TRÊN MOBILE (PHẠT TỨC THÌ)
  visibilityHandler = function () {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive) return;

    if (document.hidden) {
      clearGracePeriodTimers();
      hideGracePeriodBanner();
      triggerViolationNotification('Chuyển tab hoặc thu nhỏ trình duyệt!');
    }
  };

  // 2. TẠM MẤT FOCUS CỬA SỔ
  blurHandler = function () {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive || document.hidden) return;
    startGracePeriodCountdown('Mất tiêu điểm màn hình bài thi quá 3 giây!');
  };

  // 3. CHẠM QUAY LẠI MÀN HÌNH (HỦY ĐẾM NGƯỢC NẾU TRONG THỜI GIAN ÂN HẠN)
  focusHandler = function () {
    clearGracePeriodTimers();
    hideGracePeriodBanner();
  };

  // 4. RỜI TRANG HOẶC CHUYỂN ỨNG DỤNG BẰNG CỬ CHỈ GESTURE MOBILE
  pageHideHandler = function () {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive) return;
    clearGracePeriodTimers();
    hideGracePeriodBanner();
    triggerViolationNotification('Rời khỏi ứng dụng làm bài thi!');
  };

  document.addEventListener('visibilitychange', visibilityHandler);
  window.addEventListener('blur', blurHandler);
  window.addEventListener('focus', focusHandler);
  window.addEventListener('pagehide', pageHideHandler);

  // 5. POLLING CHECK CHO CHẾ ĐỘ CHIA ĐÔI MÀN HÌNH (SPLIT SCREEN)
  focusCheckInterval = setInterval(() => {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive || document.hidden) return;

    if (!document.hasFocus()) {
      startGracePeriodCountdown('Thao tác ngoài vùng bài thi (Chia đôi màn hình) quá 3 giây!');
    } else {
      if (blurTimer) {
        clearGracePeriodTimers();
        hideGracePeriodBanner();
      }
    }
  }, 1000);
}

function triggerViolationNotification(reason = 'Vi phạm quy chế thi') {
  if (isProcessingViolation) return;
  isProcessingViolation = true;

  window.violationCount = (window.violationCount || 0) + 1;
  const count = window.violationCount;

  const examId = window.currentActiveExamId || window.currentExamId;
  const studentCode = window.currentStudentCode || window.currentUserCode || window.studentCode;
  const answers = window.currentActiveAnswersForExam || window.currentStudentAnswers || {};

  if (examId && studentCode && typeof saveExamDraftToLocal === 'function') {
    saveExamDraftToLocal(examId, studentCode, answers, count);
  }

  window.isInternalDialogActive = true;

  // 🔑 ĐÃ SỬA: TRUYỀN ĐÚNG 3 THAM SỐ (count, reason, callback)
  showViolationModal(count, reason, () => {
    window.isInternalDialogActive = false;
    isProcessingViolation = false;

    if (count >= 3) {
      stopViolationTracking();
      if (typeof window.executeSubmitExam === 'function') {
        window.executeSubmitExam(
          examId,
          window.currentActiveQuestionsForExam || window.currentExamQuestions,
          answers,
          `Tự động nộp bài do vi phạm 3 lần: ${reason}`,
          true
        );
      }
    }
  });
}

export function stopViolationTracking() {
  window.isViolationTrackingActive = false;
  window.isInternalDialogActive = false;
  isProcessingViolation = false;

  clearGracePeriodTimers();
  hideGracePeriodBanner();

  if (focusCheckInterval) {
    clearInterval(focusCheckInterval);
    focusCheckInterval = null;
  }

  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (blurHandler) {
    window.removeEventListener('blur', blurHandler);
    blurHandler = null;
  }
  if (focusHandler) {
    window.removeEventListener('focus', focusHandler);
    focusHandler = null;
  }
  if (pageHideHandler) {
    window.removeEventListener('pagehide', pageHideHandler);
    pageHideHandler = null;
  }
}

export function showAppLoading(msg = '⏳ Đang xử lý...') {
  let loader = document.getElementById('appGlobalLoader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'appGlobalLoader';
    loader.style.cssText = `
      position: fixed; inset: 0; width: 100%; height: 100%;
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
// 8. XỬ LÝ QUÊN MẬT KHẨU VÀ OTP (TỰ ĐỘNG TRUY XUẤT TÊN TÀI KHOẢN TỪ EMAIL)
// =========================================================================
let verifiedForgotUsername = '';

export function openForgotPasswordModal() {
  const modal = document.getElementById('forgotModal');
  if (!modal) return;

  // Reset lại trạng thái các input & xóa username lưu tạm
  verifiedForgotUsername = '';
  
  const forgotInput = document.getElementById('forgotInput');
  const forgotOTP = document.getElementById('forgotOTP');
  const forgotNewPass = document.getElementById('forgotNewPass');
  const usernameDisplay = document.getElementById('forgotUsernameDisplay');
  const step1Area = document.getElementById('forgotStep1Area');
  const step2Area = document.getElementById('forgotStep2Area');

  if (forgotInput) forgotInput.value = '';
  if (forgotOTP) forgotOTP.value = '';
  if (forgotNewPass) forgotNewPass.value = '';

  // Đưa UI về Bước 1 (Nhập Tên đăng nhập / Email)
  if (step1Area) step1Area.style.display = 'block';
  if (step2Area) step2Area.style.display = 'none';
  if (usernameDisplay) {
    usernameDisplay.innerText = '';
    usernameDisplay.style.display = 'none';
  }

  modal.style.display = 'flex';
}

export function closeForgotModal() {
  const modal = document.getElementById('forgotModal');
  if (modal) modal.style.display = 'none';
  verifiedForgotUsername = '';
}

export async function sendForgotOTP() {
  const accountOrEmail = document.getElementById('forgotInput')?.value.trim();
  if (!accountOrEmail) {
    alert('⚠️ Vui lòng nhập Tên đăng nhập hoặc Email!');
    return;
  }

  showAppLoading('⏳ Đang tìm tài khoản và gửi mã OTP...');
  try {
    const res = await appsScriptService.request('SEND_OTP_FORGOT', { accountOrEmail });
    hideAppLoading();

    if (res.status === 'error') {
      alert(`❌ ${res.message}`);
      return;
    }

    // 🔑 TỰ ĐỘNG GHI NHẬN TÊN TÀI KHOẢN TỪ SERVER TRẢ VỀ (ĐẶC BIỆT KHI SV/GV NHẬP EMAIL)
    verifiedForgotUsername = res.username || accountOrEmail;

    alert(res.message || 'Mã OTP đã được gửi thành công!');

    // Tự động chuyển giao diện sang Bước 2 (Nhập OTP & Mật khẩu mới)
    const step1Area = document.getElementById('forgotStep1Area');
    const step2Area = document.getElementById('forgotStep2Area');
    const usernameDisplay = document.getElementById('forgotUsernameDisplay');
    const usernameInput = document.getElementById('forgotUsernameInput');

    if (usernameDisplay) {
      usernameDisplay.innerHTML = `👤 Tài khoản xác nhận: <strong>${escapeHtml(verifiedForgotUsername)}</strong>`;
      usernameDisplay.style.display = 'block';
    }

    if (usernameInput) {
      usernameInput.value = verifiedForgotUsername;
    }

    if (step1Area && step2Area) {
      step1Area.style.display = 'none';
      step2Area.style.display = 'block';
    }

  } catch (err) {
    hideAppLoading();
    alert(`❌ Lỗi: ${err.message}`);
  }
}

export async function submitResetPassword() {
  const otp = document.getElementById('forgotOTP')?.value.trim();
  const newPassword = document.getElementById('forgotNewPass')?.value.trim();

  if (!verifiedForgotUsername) {
    alert('⚠️ Chưa xác định được tài khoản. Vui lòng gửi mã OTP trước!');
    return;
  }

  if (!otp) {
    alert('⚠️ Vui lòng nhập mã OTP!');
    return;
  }

  if (!newPassword) {
    alert('⚠️ Vui lòng nhập mật khẩu mới!');
    return;
  }

  if (newPassword.length < 6) {
    alert('⚠️ Mật khẩu mới phải có ít nhất 6 ký tự!');
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

    if (res.status === 'error') {
      alert(`❌ ${res.message}`);
      return;
    }

    alert(res.message || '✅ Đặt lại mật khẩu thành công!');
    closeForgotModal();

    // Tự động điền lại tên tài khoản & mật khẩu mới vào Form đăng nhập
    const loginUser = document.getElementById('inputUsername');
    const loginPass = document.getElementById('inputPassword');
    if (loginUser) loginUser.value = verifiedForgotUsername;
    if (loginPass) loginPass.value = newPassword;

  } catch (err) {
    hideAppLoading();
    alert(`❌ Lỗi: ${err.message}`);
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
