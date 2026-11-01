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
// 4. THEO DÕI VI PHẠM QUY CHẾ THI (VIOLATION TRACKER ENGINE v5.0 - HASFOCUS ENGINE)
// =========================================================================
window.violationCount = 0;
window.isViolationTrackingActive = false;
window.isInternalDialogActive = false;

let visibilityHandler = null;
let blurHandler = null;
let focusHandler = null;
let pageHideHandler = null;

let blurTimer = null;           // Timer chính 5s ân hạn
let countdownInterval = null;   // Interval cập nhật UI banner (5s..4s..3s..2s..1s)
let focusCheckInterval = null;  // Interval kiểm tra document.hasFocus() ngầm cho Mobile Split-Screen & PC
let isProcessingViolation = false;
const GRACE_PERIOD_MS = 5000;   // 5 Giây ân hạn

/**
 * 4a. KIỂM TRA MÔI TRƯỜNG ZALO WEBVIEW
 */
export function isZaloWebView() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  return /Zalo/i.test(ua);
}

/**
 * 4b. HIỂN THỊ MÀN HÌNH BẮT BỘC MỞ TRÌNH DUYỆT NGOÀI
 */
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

/**
 * 4c. HIỂN THỊ / ẨN THÔNG BÁO CẢNH BÁO ÂN HẠN 5 GIÂY (FLOATING BANNER)
 */
function showGracePeriodBanner(secondsRemaining) {
  let banner = document.getElementById('gracePeriodWarningBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'gracePeriodWarningBanner';
    banner.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: #fef08a;
      border: 2px solid #eab308;
      color: #854d0e;
      padding: 12px 20px;
      border-radius: 10px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      max-width: 90%;
      width: 520px;
    `;
    document.body.appendChild(banner);
  }

  banner.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:center; gap:10px;">
      <span style="font-size:20px;">⚠️</span>
      <div style="text-align:left;">
        <div style="color:#a16207; font-weight:700; font-size:15px;">PHÁT HIỆN RỜI CỬA SỔ BÀI THI!</div>
        <div style="font-size:13px; font-weight:500; margin-top:2px;">
          Vui lòng <strong>chạm/click ngay vào màn hình bài thi</strong> để tiếp tục!
        </div>
      </div>
      <div style="background:#eab308; color:#fff; font-size:18px; font-weight:800; padding:6px 12px; border-radius:50px; min-width:42px; text-align:center; margin-left:auto;">
        ${secondsRemaining}s
      </div>
    </div>
  `;
  banner.style.display = 'block';
}

function hideGracePeriodBanner() {
  const banner = document.getElementById('gracePeriodWarningBanner');
  if (banner) {
    banner.style.display = 'none';
  }
}

/**
 * 4d. XÓA BỘ ĐẾM ÂN HẠN & BANNER
 */
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

/**
 * 4e. KÍCH HOẠT ĐẾM NGƯỢC ÂN HẠN 5S (DÙNG CHO CẢ BLUR VÀ HASFOCUS = FALSE)
 */
function startGracePeriodCountdown(reason = 'Mất tiêu điểm cửa sổ làm bài quá 5 giây!') {
  if (blurTimer || !window.isViolationTrackingActive || window.isInternalDialogActive || document.hidden) return;

  let secondsLeft = 5;
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

/**
 * 4f. BẮT ĐẦU THEO DÕI VI PHẠM
 */
export function startViolationTracking(initialCount = 0) {
  // Nếu là Zalo WebView -> Chặn làm bài ngay lập tức
  if (isZaloWebView()) {
    renderZaloBlockerScreen();
    return;
  }

  stopViolationTracking();

  window.violationCount = Number(initialCount) || 0;
  window.isViolationTrackingActive = true;
  window.isInternalDialogActive = false;
  isProcessingViolation = false;

  // TH 1: CHUYỂN TAB / ẨN TRÌNH DUYỆT (PHẠT NGAY 0 SECONDS)
  visibilityHandler = function () {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive) return;

    if (document.hidden) {
      clearGracePeriodTimers();
      hideGracePeriodBanner();
      triggerViolationNotification('Chuyển sang Tab khác hoặc thu nhỏ trình duyệt!');
    }
  };

  // TH 2: BLUR CỬA SỔ TRUYỀN THỐNG
  blurHandler = function () {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive || document.hidden) return;
    startGracePeriodCountdown('Mất tiêu điểm cửa sổ làm bài quá 5 giây!');
  };

  // KHI TƯƠNG TÁC QUAY LẠI CỬA SỔ (HỦY ÂN HẠN NẾU < 5S)
  focusHandler = function () {
    clearGracePeriodTimers();
    hideGracePeriodBanner();
  };

  // TH 3: RỜI TRANG BẰNG ĐIỀU HƯỚNG BÊN NGOÀI
  pageHideHandler = function () {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive) return;
    clearGracePeriodTimers();
    hideGracePeriodBanner();
    triggerViolationNotification('Đóng ứng dụng hoặc điều hướng rời khỏi trang thi!');
  };

  document.addEventListener('visibilitychange', visibilityHandler);
  window.addEventListener('blur', blurHandler);
  window.addEventListener('focus', focusHandler);
  window.addEventListener('pagehide', pageHideHandler);

  // TH 4: PHƯƠNG ÁN 1 - DÙNG DOCUMENT.HASFOCUS() POLLING DÀNH RIÊNG CHO MOBILE SPLIT-SCREEN & PC
  focusCheckInterval = setInterval(() => {
    if (!window.isViolationTrackingActive || window.isInternalDialogActive || document.hidden) return;

    // Nếu document mất focus (SV chạm sang ứng dụng thứ 2 khi chia đôi màn hình)
    if (!document.hasFocus()) {
      startGracePeriodCountdown('Mất tiêu điểm tương tác bài thi (Chia đôi màn hình/Cửa sổ phụ) quá 5 giây!');
    } else {
      // Nếu SV chạm tương tác lại vào trang thi -> Hủy đếm ân hạn và ẩn banner lập tức
      if (blurTimer) {
        clearGracePeriodTimers();
        hideGracePeriodBanner();
      }
    }
  }, 600);
}

/**
 * 4g. KÍCH HOẠT THÔNG BÁO VÀ TỰ ĐỘNG NỘP BÀI KHI ĐỦ 3 LẦN
 */
function triggerViolationNotification(reason = 'Vi phạm quy chế thi') {
  if (isProcessingViolation) return;
  isProcessingViolation = true;

  window.violationCount = (window.violationCount || 0) + 1;
  const count = window.violationCount;

  window.isInternalDialogActive = true;

  showViolationModal(count, reason, () => {
    window.isInternalDialogActive = false;
    isProcessingViolation = false;

    if (count >= 3) {
      stopViolationTracking();
      if (typeof window.executeSubmitExam === 'function') {
        window.executeSubmitExam(
          window.currentActiveExamId || window.currentExamId,
          window.currentActiveQuestionsForExam || window.currentExamQuestions,
          window.currentActiveAnswersForExam || window.currentStudentAnswers,
          `Tự động nộp bài do vi phạm 3 lần: ${reason}`,
          true
        );
      }
    }
  });
}

/**
 * 4h. TẮT BỘ THEO DÕI VI PHẠM KHI NỘP BÀI
 */
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
