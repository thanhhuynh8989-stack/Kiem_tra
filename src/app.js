import { 
  getLoggedInUser, 
  getLoggedInUsername, 
  getLoggedInRole, 
  handleLogin, 
  handleLogout, 
  showAppLoading, 
  hideAppLoading,
  escapeHtml,
  startViolationTracking
} from './modules/authAndCore.js';

// BỔ SUNG KHAI BÁO ĐẦY ĐỦ CÁC HÀM XEM LẠI BÀI VÀ NỘP BÀI
import { 
  handleLoadStudentDashboard, 
  handleReviewSubmittedExam, 
  renderExamReviewUI,
  executeSubmitExam
} from './modules/studentExamTaking.js';

import { handleLoadLecturerDashboard } from './modules/lecturerDashboard.js';
import { handleLoadStudentManagement } from './modules/studentManagement.js';
import { handleExamFileUpload, renderDefaultUploadScreen } from './modules/aiExamParser.js';
import { loadExamList, handleEditExam, deleteExam } from './modules/examManagement.js';
import { handleViewExamSubmissions } from './modules/gradebookManagement.js';
import { handleLoadLecturerManagement } from './modules/lecturerManagement.js';

// Biến toàn cục theo dõi Tab đang mở
window.currentActiveTab = 'tab-exams';

/**
 * =========================================================================
 * 0. TỰ ĐỘNG XỬ LÝ MẠNG KHÔI PHỤC KÈM THUẬT TOÁN JITTER (GIẢI TOẢ CÔNG SUẤT BACKEND)
 * =========================================================================
 */
window.addEventListener('online', () => {
  console.log("🟢 Kết nối Internet đã khôi phục. Đang xếp hàng nộp bài rải rác (Jitter)...");
  
  // Tạo độ trễ ngẫu nhiên Jitter từ 0 - 4 giây để kéo giãn các request nộp trùng thời điểm
  const jitterDelay = Math.floor(Math.random() * 4000);
  
  setTimeout(() => {
    if (window.isPendingSubmitOffline) {
      if (typeof window.retrySubmitExam === 'function') {
        window.retrySubmitExam();
      } else if (typeof executeSubmitExam === 'function') {
        executeSubmitExam();
      }
    }
  }, jitterDelay);
});

window.addEventListener('offline', () => {
  console.warn("⚠️ Mạng Internet bị ngắt. Bài làm vẫn được lưu an toàn 100% ở LocalStorage!");
});

/**
 * =========================================================================
 * KIỂM TRA KHÔI PHỤC PHIÊN THI THEO THỜI GIAN TUYỆT ĐỐI (ABSOLUTE TIME RECOVERY)
 * =========================================================================
 */
export function checkAndRestoreStudentSession(examId, studentCode, durationMinutes, startTimeServerMs) {
  const key = `exam_draft_${studentCode}_${examId}`;
  const rawDraft = localStorage.getItem(key);
  if (!rawDraft) return null;

  try {
    const draft = JSON.parse(rawDraft);
    const endTimeMs = startTimeServerMs + (durationMinutes * 60 * 1000);
    const nowMs = Date.now();

    if (nowMs >= endTimeMs) {
      alert('⏰ Thời gian làm bài của bạn đã kết thúc trong lúc thoát ứng dụng/rớt mạng. Hệ thống đang tự động nộp bài!');
      
      executeSubmitExam(
        draft.examId || examId,
        window.allQuestionsMap?.[examId] || window.currentActiveQuestionsForExam || [],
        draft.answers || {},
        `Tự động nộp bài do hết giờ (Khôi phục phiên làm bài)`,
        true
      );
      return { isExpired: true };
    } else {
      const remainingSeconds = Math.floor((endTimeMs - nowMs) / 1000);
      window.currentActiveAnswersForExam = draft.answers || {};
      window.violationCount = draft.violationCount || 0;

      if (typeof startViolationTracking === 'function') {
        startViolationTracking(window.violationCount);
      }

      return {
        isExpired: false,
        remainingSeconds,
        answers: draft.answers,
        violationCount: draft.violationCount
      };
    }
  } catch (err) {
    console.error("❌ Lỗi đọc bản nháp phiên làm bài:", err);
    return null;
  }
}

/**
 * =========================================================================
 * 1. HÀM CHUYỂN TAB TỨC THÌ (0ms UI LAG - BẬT DOM NGAY, NẠP DỮ LIỆU NGẦM)
 * =========================================================================
 */
export function switchTab(tabId) {
  if (!tabId) return;

  // 1. CHUẨN HÓA TÊN TAB (Đồng bộ giữa data-tab và mã tab hệ thống cũ)
  let targetTab = tabId;
  if (tabId === 'LECTURER_DASHBOARD') targetTab = 'tab-exams';
  if (tabId === 'STUDENT_MANAGEMENT') targetTab = 'tab-students';
  if (tabId === 'LECTURER_MANAGEMENT') targetTab = 'tab-lecturers';
  if (tabId === 'EXAM_EDITOR') targetTab = 'tab-parser';
  if (tabId === 'STUDENT_EXAMS') targetTab = 'tab-student-exams';

  // 2. KHÓA BẢO VỆ: CHUẨN HÓA ROLE VÀ CHẶN TRUY CẬP KHÔNG PHẢI ADMIN VÀO TAB QUẢN LÝ GIẢNG VIÊN
  if (targetTab === 'tab-lecturers') {
    const currentRole = String(getLoggedInRole() || '').trim().toUpperCase();
    if (currentRole !== 'ADMIN') {
      alert(`⚠️ Bạn không có quyền truy cập vào chức năng Quản Lý Giảng Viên! (Vai trò hiện tại: ${currentRole || 'N/A'})`);
      return;
    }
  }

  window.currentActiveTab = targetTab;

  // 3. KHAI BÁO CÁC CONTAINER TƯƠNG ỨNG VỚI TỪNG TAB GIAO DIỆN
  const containers = {
    'tab-exams': document.getElementById('lecturerDashboardContainer') || document.getElementById('examManagementContainer'),
    'tab-students': document.getElementById('studentManagementContainer'),
    'tab-lecturers': document.getElementById('lecturerManagementContainer'),
    'tab-parser': document.getElementById('examEditorContainer') || document.getElementById('examParserContainer'),
    'tab-student-exams': document.getElementById('studentExamContainer')
  };

  const loginCard = document.getElementById('loginCard');
  if (loginCard) loginCard.style.display = 'none';

  // A. CHUYỂN HIỂN THỊ DOM NGAY LẬP TỨC (0ms UI Lag)
  Object.keys(containers).forEach(key => {
    if (containers[key]) {
      containers[key].style.display = (key === targetTab) ? 'block' : 'none';
    }
  });

  // B. CẬP NHẬT TRẠNG THÁI ACTIVE VÀ HIGHLIGHT TRÊN NAVBAR
  document.querySelectorAll('nav button, [data-tab]').forEach(btn => {
    const btnTab = btn.getAttribute('data-tab');
    if (btnTab === targetTab || btn.id === getBtnIdByTab(targetTab)) {
      btn.classList.add('active');
      btn.style.fontWeight = 'bold';
      btn.style.borderBottom = '2px solid #2563eb';
    } else {
      btn.classList.remove('active');
      btn.style.fontWeight = 'normal';
      btn.style.borderBottom = 'none';
    }
  });

  // C. TẢI DỮ LIỆU CHẠY NGẦM AN TOÀN THEO TỪNG TAB (HỖ TRỢ CẢ IMPORT LẪN GLOBAL WINDOW SCOPE)
  if (targetTab === 'tab-exams') {
    if (typeof handleLoadLecturerDashboard === 'function') {
      handleLoadLecturerDashboard();
    } else if (typeof loadExamList === 'function') {
      loadExamList();
    }
  } else if (targetTab === 'tab-students') {
    if (typeof handleLoadStudentManagement === 'function') {
      handleLoadStudentManagement();
    } else if (typeof window.handleLoadStudentManagement === 'function') {
      window.handleLoadStudentManagement();
    }
  } else if (targetTab === 'tab-lecturers') {
    if (typeof handleLoadLecturerManagement === 'function') {
      handleLoadLecturerManagement();
    } else if (typeof window.handleLoadLecturerManagement === 'function') {
      window.handleLoadLecturerManagement();
    }
  } else if (targetTab === 'tab-parser') {
    const questionsEditorList = document.getElementById('questionsEditorList');
    if (!questionsEditorList || !questionsEditorList.children.length) {
      if (typeof renderDefaultUploadScreen === 'function') {
        renderDefaultUploadScreen();
      }
    }
  } else if (targetTab === 'tab-student-exams') {
    if (typeof handleLoadStudentDashboard === 'function') {
      handleLoadStudentDashboard();
    } else if (typeof window.handleLoadStudentDashboard === 'function') {
      window.handleLoadStudentDashboard();
    }
  }
}

/**
 * HÀM HỖ TRỢ MAP ID NÚT ĐIỀU HƯỚNG TRÊN NAVBAR
 */
function getBtnIdByTab(tabId) {
  if (tabId === 'tab-exams') return 'tabBtnLecturer';
  if (tabId === 'tab-students') return 'tabBtnManagement';
  if (tabId === 'tab-lecturers') return 'tabBtnLecturerManagement';
  if (tabId === 'tab-parser') return 'tabBtnEditor';
  if (tabId === 'tab-student-exams') return 'tabBtnStudent';
  return '';
}

export function switchMainTab(tabName) {
  switchTab(tabName);
}

/**
 * =========================================================================
 * 2. HÀM TẢI LẠI TRANG HIỆN TẠI (UNIVERSAL TAB RELOADER)
 * =========================================================================
 */
export function reloadCurrentTab() {
  const activeTab = window.currentActiveTab || 'tab-exams';
  switchTab(activeTab);
}

/**
 * =========================================================================
 * 3. LẮNG NGHE SỰ KIỆN CLICK TAB VỚI EVENT DELEGATION
 * =========================================================================
 */
document.addEventListener('click', (event) => {
  const tabBtn = event.target.closest('[data-tab]');
  if (tabBtn) {
    const tabId = tabBtn.getAttribute('data-tab');
    switchTab(tabId);
  }
});

/**
 * =========================================================================
 * 4. XỬ LÝ SỰ KIỆN ĐĂNG NHẬP FORM
 * =========================================================================
 */
export async function submitLoginForm() {
  const usernameInput = document.getElementById('inputUsername');
  const passwordInput = document.getElementById('inputPassword');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';

  const success = await handleLogin(username, password);
  if (success) {
    initUserSessionUI();
  }
}

/**
 * =========================================================================
 * 5. CẬP NHẬT GIAO DIỆN THEO PHIÊN ĐĂNG NHẬP (USER SESSION UI)
 * =========================================================================
 */
export function initUserSessionUI() {
  const user = getLoggedInUser();
  const loginCard = document.getElementById('loginCard');
  const appNavTabs = document.getElementById('appNavTabs');
  const userInfoDisplay = document.getElementById('userInfoDisplay');
  const btnLogout = document.getElementById('btnLogout');

  // Các nút trên Navbar
  const tabBtnStudent = document.getElementById('tabBtnStudent');
  const tabBtnLecturer = document.getElementById('tabBtnLecturer');
  const tabBtnManagement = document.getElementById('tabBtnManagement');
  const tabBtnEditor = document.getElementById('tabBtnEditor');
  const tabBtnLecturerManagement = document.getElementById('tabBtnLecturerManagement'); // Nút Quản lý Giảng viên

  if (!user) {
    if (loginCard) loginCard.style.display = 'block';
    if (appNavTabs) appNavTabs.style.display = 'none';
    if (userInfoDisplay) userInfoDisplay.innerText = 'Chưa đăng nhập';
    if (btnLogout) btnLogout.style.display = 'none';
    return;
  }

  if (loginCard) loginCard.style.display = 'none';
  if (appNavTabs) appNavTabs.style.display = 'flex';
  if (btnLogout) btnLogout.style.display = 'inline-block';

  // 🔑 CHUẨN HÓA ROLE: Loại bỏ khoảng trắng thừa và chuyển về chữ viết hoa tuyệt đối
  const role = String(getLoggedInRole() || '').trim().toUpperCase();
  const name = user.fullName || user.username || 'Người dùng';
  
  if (userInfoDisplay) {
    userInfoDisplay.innerHTML = `👤 <strong>${escapeHtml(name)}</strong> (${role})`;
  }

  // -------------------------------------------------------------------------
  // PHÂN LUỒNG HIỂN THỊ CÁC TAB NGHỆ NẠP DỰA TRÊN ROLE CHUẨN HÓA
  // -------------------------------------------------------------------------
  if (role === 'STUDENT') {
    // 1. SINH VIÊN: Chỉ hiện tab Làm bài thi
    if (tabBtnStudent) tabBtnStudent.style.display = 'inline-block';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'none';
    if (tabBtnManagement) tabBtnManagement.style.display = 'none';
    if (tabBtnEditor) tabBtnEditor.style.display = 'none';
    if (tabBtnLecturerManagement) tabBtnLecturerManagement.style.display = 'none';
    switchTab('tab-student-exams');

  } else if (role === 'ADMIN') {
    // 2. ADMIN: Hiển thị ĐẦY ĐỦ tất cả các tab (bao gồm Quản lý Giảng viên)
    if (tabBtnStudent) tabBtnStudent.style.display = 'none';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'inline-block';
    if (tabBtnManagement) tabBtnManagement.style.display = 'inline-block';
    if (tabBtnEditor) tabBtnEditor.style.display = 'inline-block';
    if (tabBtnLecturerManagement) tabBtnLecturerManagement.style.display = 'inline-block'; // 🔑 CHỈ ADMIN MỚI HIỂN THỊ
    switchTab('tab-exams');

  } else {
    // 3. GIẢNG VIÊN (LECTURER / CÁC VAI TRÒ KHÁC): Ẩn tab Quản lý Giảng viên
    if (tabBtnStudent) tabBtnStudent.style.display = 'none';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'inline-block';
    if (tabBtnManagement) tabBtnManagement.style.display = 'inline-block';
    if (tabBtnEditor) tabBtnEditor.style.display = 'inline-block';
    if (tabBtnLecturerManagement) tabBtnLecturerManagement.style.display = 'none'; // 🔑 GIẢNG VIÊN BỊ ẨN TAB NÀY
    switchTab('tab-exams');
  }
}

/**
 * =========================================================================
 * 6. KÍCH HOẠT TẢI FILE ĐỀ THI BÓC TÁCH
 * =========================================================================
 */
export function triggerExamUpload(inputElement) {
  if (inputElement && inputElement.files && inputElement.files[0]) {
    handleExamFileUpload(inputElement.files[0]);
  }
}

// =========================================================================
// 7. BIND TOÀN BỘ CÁC HÀM XỬ LÝ SỰ KIỆN VÀO WINDOW OBJECT
// =========================================================================
window.switchTab = switchTab;
window.switchMainTab = switchMainTab;
window.reloadCurrentTab = reloadCurrentTab;
window.submitLoginForm = submitLoginForm;
window.handleLogout = handleLogout;
window.triggerExamUpload = triggerExamUpload;

// Bind các hàm xem bài làm, khôi phục phiên và nộp bài toàn cục
window.handleReviewSubmittedExam = handleReviewSubmittedExam;
window.renderExamReviewUI = renderExamReviewUI;
window.executeSubmitExam = executeSubmitExam;
window.handleViewExamSubmissions = handleViewExamSubmissions;
window.checkAndRestoreStudentSession = checkAndRestoreStudentSession;

document.addEventListener('DOMContentLoaded', () => {
  initUserSessionUI();
});
