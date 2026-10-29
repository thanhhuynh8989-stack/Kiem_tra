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
import { handleExamFileUpload } from './modules/aiExamParser.js';

// =========================================================================
// 1. ĐIỀU HƯỚNG TAB CHÍNH (TAB SWITCHER)
// =========================================================================
export function switchMainTab(tabName) {
  const loginCard = document.getElementById('loginCard');
  const studentExamContainer = document.getElementById('studentExamContainer');
  const lecturerDashboardContainer = document.getElementById('lecturerDashboardContainer');
  const studentManagementContainer = document.getElementById('studentManagementContainer');
  const examEditorContainer = document.getElementById('examEditorContainer');

  const tabBtnStudent = document.getElementById('tabBtnStudent');
  const tabBtnLecturer = document.getElementById('tabBtnLecturer');
  const tabBtnManagement = document.getElementById('tabBtnManagement');
  const tabBtnEditor = document.getElementById('tabBtnEditor');

  // Ẩn tất cả các container
  if (loginCard) loginCard.style.display = 'none';
  if (studentExamContainer) studentExamContainer.style.display = 'none';
  if (lecturerDashboardContainer) lecturerDashboardContainer.style.display = 'none';
  if (studentManagementContainer) studentManagementContainer.style.display = 'none';
  if (examEditorContainer) examEditorContainer.style.display = 'none';

  // Reset lớp active trên các nút menu
  [tabBtnStudent, tabBtnLecturer, tabBtnManagement, tabBtnEditor].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });

  // Hiển thị tab được chọn và nạp dữ liệu tương ứng
  if (tabName === 'STUDENT_EXAMS') {
    if (studentExamContainer) studentExamContainer.style.display = 'block';
    if (tabBtnStudent) tabBtnStudent.classList.add('active');
    handleLoadStudentDashboard();
  } else if (tabName === 'LECTURER_DASHBOARD') {
    if (lecturerDashboardContainer) lecturerDashboardContainer.style.display = 'block';
    if (tabBtnLecturer) tabBtnLecturer.classList.add('active');
    handleLoadLecturerDashboard();
  } else if (tabName === 'STUDENT_MANAGEMENT') {
    if (studentManagementContainer) studentManagementContainer.style.display = 'block';
    if (tabBtnManagement) tabBtnManagement.classList.add('active');
    handleLoadStudentManagement();
  } else if (tabName === 'EXAM_EDITOR') {
    if (examEditorContainer) examEditorContainer.style.display = 'block';
    if (tabBtnEditor) tabBtnEditor.classList.add('active');
  }
}

// =========================================================================
// 2. XỬ LÝ SỰ KIỆN ĐĂNG NHẬP FORM
// =========================================================================
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

// =========================================================================
// 3. CẬP NHẬT GIAO DIỆN THEO PHIÊN ĐĂNG NHẬP (USER SESSION UI)
// =========================================================================
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
    // Trường hợp chưa đăng nhập
    if (loginCard) loginCard.style.display = 'block';
    if (appNavTabs) appNavTabs.style.display = 'none';
    if (userInfoDisplay) userInfoDisplay.innerText = 'Chưa đăng nhập';
    if (btnLogout) btnLogout.style.display = 'none';
    return;
  }

  // Trường hợp đã đăng nhập
  if (loginCard) loginCard.style.display = 'none';
  if (appNavTabs) appNavTabs.style.display = 'flex';
  if (btnLogout) btnLogout.style.display = 'inline-block';

  const role = getLoggedInRole();
  const name = user.fullName || user.username || 'Người dùng';
  if (userInfoDisplay) {
    userInfoDisplay.innerHTML = `👤 <strong>${name}</strong> (${role})`;
  }

  // Phân quyền hiển thị nút Menu Tab
  if (role === 'STUDENT') {
    if (tabBtnStudent) tabBtnStudent.style.display = 'inline-block';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'none';
    if (tabBtnManagement) tabBtnManagement.style.display = 'none';
    if (tabBtnEditor) tabBtnEditor.style.display = 'none';
    switchMainTab('STUDENT_EXAMS');
  } else {
    // Quyền LECTURER hoặc ADMIN
    if (tabBtnStudent) tabBtnStudent.style.display = 'none';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'inline-block';
    if (tabBtnManagement) tabBtnManagement.style.display = 'inline-block';
    if (tabBtnEditor) tabBtnEditor.style.display = 'inline-block';
    switchMainTab('LECTURER_DASHBOARD');
  }
}

// =========================================================================
// 4. KÍCH HOẠT TẢI FILE ĐỀ THI BÓC TÁCH
// =========================================================================
export function triggerExamUpload(inputElement) {
  if (inputElement && inputElement.files && inputElement.files[0]) {
    handleExamFileUpload(inputElement.files[0]);
  }
}

// =========================================================================
// 5. GẮN CÁC HÀM VÀO SCOPE WINDOW ĐỂ HTML TRUY XUẤT ĐƯỢC
// =========================================================================
window.switchMainTab = switchMainTab;
window.submitLoginForm = submitLoginForm;
window.triggerExamUpload = triggerExamUpload;

// Tự động chạy khi DOM được tải xong
document.addEventListener('DOMContentLoaded', () => {
  initUserSessionUI();
});
