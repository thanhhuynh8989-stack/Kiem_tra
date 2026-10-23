import { 
  currentUser, 
  normalizeUserData, 
  handleLogin, 
  handleLogout, 
  showView 
} from './modules/authAndCore.js';

import { 
  handleProcessExamWithAI, 
  handlePublishExam, 
  handleLoadMyExams 
} from './modules/aiExamParser.js';

import './modules/studentExamTaking.js';
import './modules/studentManagement.js';
import { appsScriptService } from './services/appsScriptService.js';

// =========================================================================
// QUẢN LÝ DANH SÁCH TÀI KHOẢN (DÀNH CHO ADMIN)
// =========================================================================
async function handleLoadUsers() {
  try {
    const res = await appsScriptService.request('GET_USERS_LIST');
    const users = res.data || res || [];
    
    let html = `
      <div class="table-responsive">
        <table border="1" style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
          <tr style="background:#f1f5f9;"><th style="padding:8px;">Username</th><th style="padding:8px;">Họ tên</th><th style="padding:8px;">Vai trò</th></tr>
    `;
    
    const userArray = Array.isArray(users) ? users : [users];
    userArray.forEach(u => {
      const normUser = normalizeUserData(u);
      html += `<tr><td style="padding:8px;">${normUser.username}</td><td style="padding:8px;">${normUser.fullName}</td><td style="padding:8px;">${normUser.role}</td></tr>`;
    });
    
    html += '</table></div>';
    const usersContainer = document.getElementById('usersListTable');
    if (usersContainer) usersContainer.innerHTML = html;
  } catch (err) {
    alert('Lỗi tải danh sách người dùng!');
  }
}

// =========================================================================
// BẮT SỰ KIỆN VÀ KHỞI TẠO HỆ THỐNG
// =========================================================================
function bindEvents() {
  const rawSession = sessionStorage.getItem('currentUser') || sessionStorage.getItem('userSession');
  
  if (rawSession) {
    try {
      const user = normalizeUserData(JSON.parse(rawSession));
      sessionStorage.setItem('currentUser', JSON.stringify(user));
      sessionStorage.setItem('userSession', JSON.stringify(user));

      const role = user.role;
      if (role === 'ADMIN') {
        showView('adminView');
      } else if (role === 'LECTURER') {
        showView('lecturerView');
      } else {
        showView('studentView');
      }
    } catch (e) {
      sessionStorage.removeItem('currentUser');
      sessionStorage.removeItem('userSession');
      showView('authView');
    }
  } else {
    showView('authView');
  }

  document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('processExamBtn')?.addEventListener('click', handleProcessExamWithAI);
  document.getElementById('publishExamBtn')?.addEventListener('click', handlePublishExam);
  document.getElementById('loadMyExamsBtn')?.addEventListener('click', handleLoadMyExams);
  document.getElementById('loadUsersBtn')?.addEventListener('click', handleLoadUsers);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindEvents);
} else {
  bindEvents();
}
