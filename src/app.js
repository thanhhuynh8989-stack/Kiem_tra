// =========================================================================
// FILE: src/app.js
// =========================================================================

import {
  getLoggedInUser,
  getLoggedInRole,
  handleLogin,
  handleLogout,
  escapeHtml,
  openForgotPasswordModal,
  closeForgotModal,
  sendForgotOTP,
  submitResetPassword,
  openRegisterLecturerModal,
  closeRegisterModal,
  sendRegisterOTP,
  submitLecturerRegistration,
  togglePasswordVisibility
} from './modules/authAndCore.js';

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

window.currentActiveTab = 'tab-exams';

/**
 * 0. TỰ ĐỘNG KHÔI PHỤC KẾT NỐI MẠNG KÈM JITTER
 */
window.addEventListener('online', () => {
  console.log('🌐 Kết nối Internet đã khôi phục. Đang xếp hàng nộp bài rải rác (Jitter)...');
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
  console.warn('⚠️ Mạng Internet bị ngắt. Bài làm vẫn được lưu an toàn ở LocalStorage!');
});

/**
 * KHÔI PHỤC PHIÊN THI THEO THỜI GIAN TUYỆT ĐỐI (ABSOLUTE TIME RECOVERY)
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
        'Tự động nộp bài do hết giờ (Khôi phục phiên làm bài)',
        true
      );
      return { isExpired: true };
    } else {
      const remainingSeconds = Math.floor((endTimeMs - nowMs) / 1000);
      window.currentActiveAnswersForExam = draft.answers || {};
      window.violationCount = draft.violationCount || 0;
      return {
        isExpired: false,
        remainingSeconds,
        answers: draft.answers,
        violationCount: draft.violationCount
      };
    }
  } catch (err) {
    console.error('❌ Lỗi đọc bản nháp phiên làm bài:', err);
    return null;
  }
}

/**
 * 1. HÀM CHUYỂN TAB TỨC THÌ (0ms UI LAG - BẬT DOM NGAY, NẠP DỮ LIỆU NGẦM)
 */
export function switchTab(tabId) {
  if (!tabId) return;

  let targetTab = tabId;
  if (tabId === 'LECTURER_DASHBOARD') targetTab = 'tab-exams';
  if (tabId === 'STUDENT_MANAGEMENT') targetTab = 'tab-students';
  if (tabId === 'LECTURER_MANAGEMENT') targetTab = 'tab-lecturers';
  if (tabId === 'EXAM_EDITOR') targetTab = 'tab-parser';
  if (tabId === 'STUDENT_EXAMS') targetTab = 'tab-student-exams';

  if (targetTab === 'tab-lecturers') {
    const currentRole = String(getLoggedInRole() || '').trim().toUpperCase();
    if (currentRole !== 'ADMIN') {
      alert(`⚠️ Bạn không có quyền truy cập vào chức năng Quản Lý Giảng Viên! (Role: ${currentRole || 'N/A'})`);
      return;
    }
  }

  window.currentActiveTab = targetTab;

  const containers = {
    'tab-exams': document.getElementById('lecturerDashboardContainer') || document.getElementById('examManagementContainer'),
    'tab-students': document.getElementById('studentManagementContainer'),
    'tab-lecturers': document.getElementById('lecturerManagementContainer'),
    'tab-parser': document.getElementById('examEditorContainer') || document.getElementById('examParserContainer'),
    'tab-student-exams': document.getElementById('studentExamContainer')
  };

  const loginCard = document.getElementById('loginCard');
  if (loginCard) loginCard.style.display = 'none';

  // Dọn dẹp DOM các tab khác để tránh đè giao diện
  const mainArea = document.getElementById('mainContentArea') || document.querySelector('main');
  if (mainArea) {
    Array.from(mainArea.children).forEach(child => {
      if (child.id !== 'loginCard') {
        child.style.display = 'none';
      }
    });
  }

  const activeContainer = containers[targetTab];
  if (activeContainer) {
    activeContainer.style.display = 'block';
  }

  // Active Navbar Button Highlight
  document.querySelectorAll('nav button, [data-tab]').forEach(btn => {
    const btnTab = btn.getAttribute('data-tab');
    if (btnTab === targetTab || btn.id === getBtnIdByTab(targetTab)) {
      btn.classList.add('active');
      btn.style.fontWeight = 'bold';
    } else {
      btn.classList.remove('active');
      btn.style.fontWeight = 'normal';
    }
  });

  // Nạp dữ liệu chạy ngầm tương ứng từng tab
  if (targetTab === 'tab-exams') {
    if (typeof handleLoadLecturerDashboard === 'function') handleLoadLecturerDashboard();
    else if (typeof loadExamList === 'function') loadExamList();
  } else if (targetTab === 'tab-students') {
    if (typeof handleLoadStudentManagement === 'function') handleLoadStudentManagement();
  } else if (targetTab === 'tab-lecturers') {
    if (typeof handleLoadLecturerManagement === 'function') handleLoadLecturerManagement();
  } else if (targetTab === 'tab-parser') {
    const questionsEditorList = document.getElementById('questionsEditorList');
    if (!questionsEditorList || !questionsEditorList.children.length) {
      if (typeof renderDefaultUploadScreen === 'function') renderDefaultUploadScreen();
    }
  } else if (targetTab === 'tab-student-exams') {
    if (typeof handleLoadStudentDashboard === 'function') handleLoadStudentDashboard();
  }
}

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

export function reloadCurrentTab() {
  const activeTab = window.currentActiveTab || 'tab-exams';
  switchTab(activeTab);
}

document.addEventListener('click', (event) => {
  const tabBtn = event.target.closest('[data-tab]');
  if (tabBtn) {
    const tabId = tabBtn.getAttribute('data-tab');
    switchTab(tabId);
  }
});

/**
 * 2. XỬ LÝ ĐĂNG NHẬP FORM & USER SESSION UI
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
  const tabBtnLecturerManagement = document.getElementById('tabBtnLecturerManagement');

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

  const role = String(getLoggedInRole() || '').trim().toUpperCase();
  const name = user.fullName || user.username || 'Người dùng';

  if (userInfoDisplay) {
    userInfoDisplay.innerHTML = `<strong>${escapeHtml(name)}</strong> (${role})`;
  }

  if (role === 'STUDENT') {
    if (tabBtnStudent) tabBtnStudent.style.display = 'inline-block';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'none';
    if (tabBtnManagement) tabBtnManagement.style.display = 'none';
    if (tabBtnEditor) tabBtnEditor.style.display = 'none';
    if (tabBtnLecturerManagement) tabBtnLecturerManagement.style.display = 'none';
    switchTab('tab-student-exams');
  } else if (role === 'ADMIN') {
    if (tabBtnStudent) tabBtnStudent.style.display = 'none';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'inline-block';
    if (tabBtnManagement) tabBtnManagement.style.display = 'inline-block';
    if (tabBtnEditor) tabBtnEditor.style.display = 'inline-block';
    if (tabBtnLecturerManagement) tabBtnLecturerManagement.style.display = 'inline-block';
    switchTab('tab-exams');
  } else {
    if (tabBtnStudent) tabBtnStudent.style.display = 'none';
    if (tabBtnLecturer) tabBtnLecturer.style.display = 'inline-block';
    if (tabBtnManagement) tabBtnManagement.style.display = 'inline-block';
    if (tabBtnEditor) tabBtnEditor.style.display = 'inline-block';
    if (tabBtnLecturerManagement) tabBtnLecturerManagement.style.display = 'none';
    switchTab('tab-exams');
  }
}

export function triggerExamUpload(inputElement) {
  if (inputElement && inputElement.files && inputElement.files[0]) {
    handleExamFileUpload(inputElement.files[0]);
  }
}

// BIND TO WINDOW
window.switchTab = switchTab;
window.switchMainTab = switchMainTab;
window.reloadCurrentTab = reloadCurrentTab;
window.submitLoginForm = submitLoginForm;
window.handleLogout = handleLogout;
window.triggerExamUpload = triggerExamUpload;

window.togglePasswordVisibility = togglePasswordVisibility;
window.openForgotPasswordModal = openForgotPasswordModal;
window.closeForgotModal = closeForgotModal;
window.sendForgotOTP = sendForgotOTP;
window.submitResetPassword = submitResetPassword;
window.openRegisterLecturerModal = openRegisterLecturerModal;
window.closeRegisterModal = closeRegisterModal;
window.sendRegisterOTP = sendRegisterOTP;
window.submitLecturerRegistration = submitLecturerRegistration;

window.handleReviewSubmittedExam = handleReviewSubmittedExam;
window.renderExamReviewUI = renderExamReviewUI;
window.executeSubmitExam = executeSubmitExam;
window.handleViewExamSubmissions = handleViewExamSubmissions;
window.checkAndRestoreStudentSession = checkAndRestoreStudentSession;

window.handleLoadLecturerManagement = handleLoadLecturerManagement;
window.handleLoadStudentManagement = handleLoadStudentManagement;
window.handleLoadLecturerDashboard = handleLoadLecturerDashboard;
window.handleLoadStudentDashboard = handleLoadStudentDashboard;
window.loadExamList = loadExamList;
window.handleEditExam = handleEditExam;
window.deleteExam = deleteExam;

document.addEventListener('DOMContentLoaded', () => {
  initUserSessionUI();
});