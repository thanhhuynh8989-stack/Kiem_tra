import { 
  getLoggedInUser, 
  getLoggedInUsername, 
  getLoggedInRole, 
  handleLogin, 
  handleLogout, 
  showAppLoading, 
  hideAppLoading,
  escapeHtml 
} from './modules/authAndCore.js';

import { handleLoadStudentDashboard } from './modules/studentExamTaking.js';
import { handleLoadLecturerDashboard } from './modules/lecturerDashboard.js';
import { handleLoadStudentManagement } from './modules/studentManagement.js';
import { handleExamFileUpload, renderDefaultUploadScreen } from './modules/aiExamParser.js';
import { loadExamList, handleEditExam, deleteExam } from './modules/examManagement.js';
import './modules/gradebookManagement.js';

// Biến toàn cục theo dõi Tab đang mở
window.currentActiveTab = 'tab-exams';

/**
 * =========================================================================
 * 1. HÀM CHUYỂN TAB TỨC THÌ (0ms UI LAG - BẬT DOM NGAY, NẠP DỮ LIỆU NGẦM)
 * =========================================================================
 */
export function switchTab(tabId) {
  if (!tabId) return;

  // Chuẩn hóa tên tab (Đồng bộ giữa data-tab và mã tab legacy)
  let targetTab = tabId;
  if (tabId === 'LECTURER_DASHBOARD') targetTab = 'tab-exams';
  if (tabId === 'STUDENT_MANAGEMENT') targetTab = 'tab-students';
  if (tabId === 'EXAM_EDITOR') targetTab = 'tab-parser';
  if (tabId === 'STUDENT_EXAMS') targetTab = 'tab-student-exams';

  window.currentActiveTab = targetTab;

  const containers = {
    'tab-exams': document.getElementById('lecturerDashboardContainer') || document.getElementById('examManagementContainer'),
    'tab-students': document.getElementById('studentManagementContainer'),
    'tab-parser': document.getElementById('examEditorContainer') || document.getElementById('examParserContainer'),
    'tab-student-exams': document.getElementById('studentExamContainer')
  };

  const loginCard = document.getElementById('loginCard');
  if (loginCard) loginCard.style.display = 'none';

  // A. CHUYỂN HIỂN THỊ DOM NGAY LẬP TỨC (0ms Delay)
  Object.keys(containers).forEach(key => {
    if (containers[key]) {
      containers[key].style.display = (key === targetTab) ? 'block' : 'none';
    }
  });

  // B. CẬP NHẬT TRẠNG THÁI ACTIVE TRÊN NAVBAR
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

  // C. TẢI DỮ LIỆU CHẠY NGẦM SAU KHI ĐÃ ĐỔI GIAO DIỆN
  if (targetTab === 'tab-exams') {
    if (typeof handleLoadLecturerDashboard === 'function') {
      handleLoadLecturerDashboard();
    } else if (typeof loadExamList === 'function') {
      loadExamList();
    }
  } else if (targetTab === 'tab-students') {
    if (typeof handleLoadStudentManagement === 'function') {
      handleLoadStudentManagement();
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
    }
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

// Tương thích ngược với hàm gọi cũ
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

  const tabBtnStudent = document.getElementById('tabBtnStudent');
  const tabBtnLecturer = document.getElementById('tabBtnLecturer');
  const tabBtnManagement = document.getElementById('tabBtnManagement');
  const tabBtnEditor = document.getElementById('tabBtnEditor');

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

  const role = getLoggedInRole();
  const name = user.fullName || user.username || 'Người dùng';
  if (userInfoDisplay) {
    userInfoDisplay.innerHTML = `👤 <strong>${escapeHtml(name)}</strong> (${role})`;
  }

  if (role === 'STUDENT') {
    if (tabBtnStudent) tabBtnStudent.style.display = 'inline-block';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'none';
    if (tabBtnManagement) tabBtnManagement.style.display = 'none';
    if (tabBtnEditor) tabBtnEditor.style.display = 'none';
    switchTab('tab-student-exams');
  } else {
    if (tabBtnStudent) tabBtnStudent.style.display = 'none';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'inline-block';
    if (tabBtnManagement) tabBtnManagement.style.display = 'inline-block';
    if (tabBtnEditor) tabBtnEditor.style.display = 'inline-block';
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

// Global scope window bindings
window.switchTab = switchTab;
window.switchMainTab = switchMainTab;
window.reloadCurrentTab = reloadCurrentTab;
window.submitLoginForm = submitLoginForm;
window.handleLogout = handleLogout;
window.triggerExamUpload = triggerExamUpload;

// Khởi chạy hệ thống ngay sau khi load DOM
document.addEventListener('DOMContentLoaded', () => {
  initUserSessionUI();
});
