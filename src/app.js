import { 
  getLoggedInUser, 
  getLoggedInUsername, 
  getLoggedInRole, 
  handleLogin, 
  handleLogout, 
  showAppLoading, 
  hideAppLoading 
} from './modules/authAndCore.js';
import { handleLoadStudentDashboard } from './modules/studentExamTaking.js';
import { handleLoadLecturerDashboard } from './modules/lecturerDashboard.js';
import { handleLoadStudentManagement } from './modules/studentManagement.js';
import { handleExamFileUpload, renderDefaultUploadScreen } from './modules/aiExamParser.js';
import { loadExamList, handleEditExam, deleteExam } from './modules/examManagement.js';

// Biến toàn cục theo dõi Tab đang mở
window.currentActiveTab = 'tab-exams';

/**
 * =========================================================================
 * 1. HÀM CHUYỂN TAB DUY NHẤT VÀ AN TOÀN (UNIFIED TAB SWITCHER)
 * =========================================================================
 */
export function switchTab(tabId) {
  if (!tabId) return;

  // Chuẩn hóa tên tab (Đồng bộ giữa data-tab và tên tab cũ)
  let targetTab = tabId;
  if (tabId === 'LECTURER_DASHBOARD') targetTab = 'tab-exams';
  if (tabId === 'STUDENT_MANAGEMENT') targetTab = 'tab-students';
  if (tabId === 'EXAM_EDITOR') targetTab = 'tab-parser';
  if (tabId === 'STUDENT_EXAMS') targetTab = 'tab-student-exams';

  window.currentActiveTab = targetTab;

  // A. Lấy tất cả các Khung hiển thị (Containers)
  const loginCard = document.getElementById('loginCard');
  const studentExamContainer = document.getElementById('studentExamContainer');
  const lecturerDashboardContainer = document.getElementById('lecturerDashboardContainer');
  const studentManagementContainer = document.getElementById('studentManagementContainer');
  const examEditorContainer = document.getElementById('examEditorContainer');

  // B. Ẩn tất cả Container trước để tránh đè giao diện
  if (loginCard) loginCard.style.display = 'none';
  if (studentExamContainer) studentExamContainer.style.display = 'none';
  if (lecturerDashboardContainer) lecturerDashboardContainer.style.display = 'none';
  if (studentManagementContainer) studentManagementContainer.style.display = 'none';
  if (examEditorContainer) examEditorContainer.style.display = 'none';

  // C. Cập nhật trạng thái Active trên Thanh Menu Navigation
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

  // D. Bật Khung tương ứng và Nạp dữ liệu
  if (targetTab === 'tab-exams') {
    if (lecturerDashboardContainer) lecturerDashboardContainer.style.display = 'block';
    handleLoadLecturerDashboard();
  } else if (targetTab === 'tab-students') {
    if (studentManagementContainer) studentManagementContainer.style.display = 'block';
    handleLoadStudentManagement();
  } else if (targetTab === 'tab-parser') {
    if (examEditorContainer) examEditorContainer.style.display = 'block';
    const parserContent = document.getElementById('questionsEditorList') || document.getElementById('examEditorContainer');
    if (parserContent && !parserContent.innerHTML.trim()) {
      renderDefaultUploadScreen();
    }
  } else if (targetTab === 'tab-student-exams') {
    if (studentExamContainer) studentExamContainer.style.display = 'block';
    handleLoadStudentDashboard();
  }
}

// Hàm hỗ trợ map ID nút Menu
function getBtnIdByTab(tabId) {
  if (tabId === 'tab-exams') return 'tabBtnLecturer';
  if (tabId === 'tab-students') return 'tabBtnManagement';
  if (tabId === 'tab-parser') return 'tabBtnEditor';
  if (tabId === 'tab-student-exams') return 'tabBtnStudent';
  return '';
}

// Tương thích ngược với các hàm gọi switchMainTab cũ
export function switchMainTab(tabName) {
  switchTab(tabName);
}

/**
 * =========================================================================
 * 2. LẮNG NGHE SỰ KIỆN CLICK TAB VỚI EVENT DELEGATION (DUY NHẤT 1 LISTENER)
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
 * 3. XỬ LÝ SỰ KIỆN ĐĂNG NHẬP FORM
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
 * 4. CẬP NHẬT GIAO DIỆN THEO PHIÊN ĐĂNG NHẬP (USER SESSION UI)
 * =========================================================================
 */
export function initUserSessionUI() {
  const user = getLoggedInUser();
  const loginCard = document.getElementById('loginCard');
  const appNavTabs = document.getElementById('appNavTabs');
  const userInfoDisplay = document.getElementById('userInfoDisplay');
  const btnLogout = document.getElementById('btnLogout');

  const tabBtnStudent = document.getElementById('tabBtnStudent');
  const tabBtnLecturer = document.getElementById('tabBtnLecturer');
  const tabBtnManagement = document.getElementById('tabBtnManagement');
  const tabBtnEditor = document.getElementById('tabBtnEditor');

  if (!user) {
    // Chưa đăng nhập
    if (loginCard) loginCard.style.display = 'block';
    if (appNavTabs) appNavTabs.style.display = 'none';
    if (userInfoDisplay) userInfoDisplay.innerText = 'Chưa đăng nhập';
    if (btnLogout) btnLogout.style.display = 'none';
    return;
  }

  // Đã đăng nhập
  if (loginCard) loginCard.style.display = 'none';
  if (appNavTabs) appNavTabs.style.display = 'flex';
  if (btnLogout) btnLogout.style.display = 'inline-block';

  const role = getLoggedInRole();
  const name = user.fullName || user.username || 'Người dùng';
  if (userInfoDisplay) {
    userInfoDisplay.innerHTML = `👤 <strong>${name}</strong> (${role})`;
  }

  // Phân quyền hiển thị Menu
  if (role === 'STUDENT') {
    if (tabBtnStudent) tabBtnStudent.style.display = 'inline-block';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'none';
    if (tabBtnManagement) tabBtnManagement.style.display = 'none';
    if (tabBtnEditor) tabBtnEditor.style.display = 'none';
    switchTab('tab-student-exams');
  } else {
    // Quyền LECTURER hoặc ADMIN
    if (tabBtnStudent) tabBtnStudent.style.display = 'none';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'inline-block';
    if (tabBtnManagement) tabBtnManagement.style.display = 'inline-block';
    if (tabBtnEditor) tabBtnEditor.style.display = 'inline-block';
    switchTab('tab-exams');
  }
}

/**
 * =========================================================================
 * 5. KÍCH HOẠT TẢI FILE ĐỀ THI BÓC TÁCH
 * =========================================================================
 */
export function triggerExamUpload(inputElement) {
  if (inputElement && inputElement.files && inputElement.files[0]) {
    handleExamFileUpload(inputElement.files[0]);
  }
}

// Attach scope window
window.switchTab = switchTab;
window.switchMainTab = switchMainTab;
window.submitLoginForm = submitLoginForm;
window.triggerExamUpload = triggerExamUpload;

// Khởi chạy khi tải xong trang
document.addEventListener('DOMContentLoaded', () => {
  initUserSessionUI();
});
