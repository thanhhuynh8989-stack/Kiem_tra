import { appsScriptService } from '../services/appsScriptService.js';
import { 
  currentUser, 
  getLoggedInUsername, 
  showAppLoading, 
  hideAppLoading, 
  escapeHtml 
} from './authAndCore.js';

window.currentStudentsList = [];

// =========================================================================
// 1. RENDER GIAO DIỆN QUẢN LÝ SINH VIÊN
// =========================================================================
export function renderStudentManagementUI(students = []) {
  window.currentStudentsList = students;
  const container = document.getElementById('studentManagementContainer');
  if (!container) return;

  const username = getLoggedInUsername();

  container.innerHTML = `
    <div style="margin-top: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
        <span style="font-size: 12px; color: var(--text-muted);">Tài khoản: <strong style="color: var(--primary);">${username}</strong> (${students.length} SV)</span>
        
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <label style="background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
            📁 Nhập Excel
            <input type="file" accept=".xlsx, .xls" onchange="handleUploadExcelDrive(event)" style="display: none;">
          </label>

          <button type="button" onclick="handlePromptAddStudent()" style="background: #2563eb; min-height: 34px; padding: 4px 10px; font-size: 12px;">
            ➕ Thêm 1 SV
          </button>
        </div>
      </div>

      <div class="table-responsive">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid var(--border); color: #475569;">
              <th style="padding: 8px;">Mã SV</th>
              <th style="padding: 8px;">Họ & Tên</th>
              <th style="padding: 8px;">Lớp</th>
              <th style="padding: 8px; text-align: right;">Hành động</th>
            </tr>
          </thead>
          <tbody>
            ${students.length === 0 ? `
              <tr><td colspan="4" style="text-align: center; padding: 16px; color: var(--text-muted);">Chưa có dữ liệu sinh viên.</td></tr>
            ` : students.map((st) => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px; font-weight: 600; font-family: monospace;">${escapeHtml(st.studentCode || st.username)}</td>
                <td style="padding: 8px;">${escapeHtml(st.fullName)}</td>
                <td style="padding: 8px; color: var(--primary); font-weight: 600;">${escapeHtml(st.className || '--')}</td>
                <td style="padding: 8px; text-align: right; white-space: nowrap;">
                  <button type="button" onclick="handleResetPasswordUI('${st.studentCode || st.username}')" style="background: #f59e0b; min-height: 30px; padding: 2px 8px; font-size: 11px;">🔑 Đặt MK</button>
                  <button type="button" onclick="handleDeleteStudentUI('${st.studentCode || st.username}')" style="background: #ef4444; min-height: 30px; padding: 2px 8px; font-size: 11px;">🗑️ Xóa</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// =========================================================================
// 2. UPLOAD TỆP EXCEL LÊN GOOGLE DRIVE & QUẢN LÝ TÀI KHOẢN
// =========================================================================
export function handleUploadExcelDrive(event) {
  const file = event.target.files[0];
  if (!file) return;

  const loggedUser = getLoggedInUsername() || 'admin';
  showAppLoading(`📂 Đang tải tệp Excel lên hệ thống...`);

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const bytes = new Uint8Array(e.target.result);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64Data = btoa(binary);

      const res = await appsScriptService.request('UPLOAD_EXCEL_DRIVE', {
        fileData: base64Data, fileName: file.name, uploadedBy: loggedUser
      });

      hideAppLoading();
      alert(res.message || '✅ Đã nhập danh sách thành công!');
      handleLoadStudents();
    } catch (err) {
      hideAppLoading();
      alert(`Lỗi upload file: ${err.message}`);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

export async function handleLoadStudents() {
  const username = getLoggedInUsername();
  const role = currentUser?.role || 'LECTURER';

  showAppLoading('⏳ Đang tải danh sách sinh viên...');
  try {
    const res = await appsScriptService.request('GET_STUDENTS', { username, role });
    const students = res.students || res.data || [];
    window.currentStudentsList = students;
    renderStudentManagementUI(students);
  } catch (err) {
    console.error(err);
  } finally {
    hideAppLoading();
  }
}

export async function handleResetPasswordUI(studentCode) {
  const newPassword = prompt(`🔑 Đặt lại mật khẩu cho SV [${studentCode}]:`, '123456');
  if (!newPassword || !newPassword.trim()) return;

  showAppLoading('⏳ Đang đổi mật khẩu...');
  try {
    const res = await appsScriptService.request('RESET_STUDENT_PASSWORD', {
      studentCode, newPassword: newPassword.trim()
    });
    hideAppLoading();
    alert(res.message || '✅ Đã đổi mật khẩu!');
    handleLoadStudents();
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

export async function handlePromptAddStudent() {
  const username = prompt('Nhập Mã Sinh Viên:');
  if (!username) return;
  const fullName = prompt('Nhập Họ tên:', username) || username;
  const className = prompt('Nhập Lớp:', '') || '';
  const password = prompt('Nhập Mật khẩu:', '123456') || '123456';

  try {
    const res = await appsScriptService.request('SAVE_STUDENT_LIST', {
      students: [{ username, fullName, className, password }]
    });
    alert(res.message || '✅ Đã thêm sinh viên!');
    handleLoadStudents();
  } catch (err) {
    alert(`Lỗi: ${err.message}`);
  }
}

export async function handleDeleteStudentUI(studentCode) {
  if (!confirm(`❓ BẠN CÓ CHẮC CHẮN MUỐN XÓA SV [${studentCode}]?`)) return;
  showAppLoading('⏳ Đang xóa sinh viên...');
  try {
    const res = await appsScriptService.request('DELETE_STUDENT', { studentCode });
    alert(res.message || '✅ Đã xóa sinh viên!');
    handleLoadStudents();
  } catch (err) {
    alert(`Lỗi: ${err.message}`);
  } finally {
    hideAppLoading();
  }
}

// =========================================================================
// 3. MODAL VÀ THAO TÁC GIAO ĐỀ THI (ASSIGN EXAM)
// =========================================================================
export function handleOpenAssignModal(examId, examTitle = '') {
  let students = window.currentStudentsList || [];
  const classList = [...new Set(students.map(s => String(s.className || s.class || '').trim()).filter(Boolean))];

  const oldModal = document.getElementById('assignExamModalOverlay');
  if (oldModal) oldModal.remove();

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'assignExamModalOverlay';
  modalOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px);
    z-index: 99999; display: flex; justify-content: center; align-items: center;
    padding: 12px; box-sizing: border-box;
  `;

  modalOverlay.innerHTML = `
    <div style="background: #ffffff; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; border-radius: 12px; padding: 20px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2);">
      
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 10px;">
        <h3 style="margin: 0; font-size: 16px; color: #0f172a;">📤 Giao Đề Thi</h3>
        <button type="button" onclick="document.getElementById('assignExamModalOverlay').remove()" style="background: none; border: none; font-size: 20px; color: #64748b; min-height: auto; padding: 0;">✕</button>
      </div>

      <div style="background: #eff6ff; padding: 8px 12px; border-radius: 6px; color: #1e40af; font-size: 12px; font-weight: 600; margin-bottom: 14px;">
        📖 ${escapeHtml(examTitle || examId)}
      </div>

      <div style="margin-bottom: 14px;">
        <label>Phạm vi giao đề:</label>
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: normal; margin: 0;">
            <input type="radio" name="assignTypeRadio" value="CLASS" checked onchange="toggleAssignTypeFields('CLASS')"> Theo Lớp
          </label>
          <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: normal; margin: 0;">
            <input type="radio" name="assignTypeRadio" value="STUDENT" onchange="toggleAssignTypeFields('STUDENT')"> Theo SV
          </label>
        </div>
      </div>

      <div id="assignClassContainer" style="margin-bottom: 16px;">
        <label>Chọn Lớp học:</label>
        <select id="assignClassSelect">
          <option value="">-- Chọn Lớp --</option>
          ${classList.map(c => `<option value="${escapeHtml(c)}">Lớp: ${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>

      <div id="assignStudentContainer" style="display: none; margin-bottom: 16px;">
        <label>Chọn Sinh viên:</label>
        <select id="assignStudentSelect">
          <option value="">-- Chọn Sinh Viên --</option>
          ${students.map(s => `<option value="${escapeHtml(s.username || s.user)}">${s.username} - ${escapeHtml(s.fullName)}</option>`).join('')}
        </select>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px;">
        <button type="button" onclick="document.getElementById('assignExamModalOverlay').remove()" style="background: #f1f5f9; color: #475569; min-height: 36px; padding: 6px 14px;">Hủy</button>
        <button type="button" onclick="handleConfirmAssignExam('${examId}')" style="background: #059669; min-height: 36px; padding: 6px 16px;">🚀 Giao Đề</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);
}

export function toggleAssignTypeFields(type) {
  const classBox = document.getElementById('assignClassContainer');
  const studentBox = document.getElementById('assignStudentContainer');
  if (classBox) classBox.style.display = type === 'CLASS' ? 'block' : 'none';
  if (studentBox) studentBox.style.display = type === 'STUDENT' ? 'block' : 'none';
}

export async function handleConfirmAssignExam(examId) {
  const selectedType = document.querySelector('input[name="assignTypeRadio"]:checked')?.value || 'CLASS';
  let targetValue = '';
  let targetStudents = [];

  if (selectedType === 'CLASS') {
    const classSel = document.getElementById('assignClassSelect');
    targetValue = classSel ? classSel.value.trim() : '';
    if (!targetValue) return alert('⚠️ Vui lòng chọn Lớp!');
  } else if (selectedType === 'STUDENT') {
    const studentSel = document.getElementById('assignStudentSelect');
    const stUser = studentSel ? studentSel.value.trim() : '';
    if (!stUser) return alert('⚠️ Vui lòng chọn Sinh viên!');
    targetStudents = [stUser];
  }

  const username = getLoggedInUsername();

  try {
    const res = await appsScriptService.request('ASSIGN_EXAM', {
      examId: examId,
      assignType: selectedType,
      targetValue: targetValue,
      targetStudents: targetStudents,
      assignedBy: username
    });

    alert(res.message || '✅ Đã giao đề thi thành công!');
    document.getElementById('assignExamModalOverlay')?.remove();
  } catch (err) {
    alert(`Lỗi giao đề thi: ${err.message}`);
  }
}

// Bán các hàm ra Window toàn cục
window.renderStudentManagementUI = renderStudentManagementUI;
window.handleUploadExcelDrive = handleUploadExcelDrive;
window.handleLoadStudents = handleLoadStudents;
window.handleResetPasswordUI = handleResetPasswordUI;
window.handlePromptAddStudent = handlePromptAddStudent;
window.handleDeleteStudentUI = handleDeleteStudentUI;
window.handleOpenAssignModal = handleOpenAssignModal;
window.toggleAssignTypeFields = toggleAssignTypeFields;
window.handleConfirmAssignExam = handleConfirmAssignExam;
