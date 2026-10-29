import { appsScriptService } from '../services/appsScriptService.js';
import { showAppLoading, hideAppLoading, getLoggedInUsername, getLoggedInRole, escapeHtml } from './authAndCore.js';

/**
 * STUDENT & ASSIGNMENT MANAGEMENT MODULE
 */

// =========================================================================
// 1. NẠP DANH SÁCH SINH VIÊN TỪ BACKEND APPS SCRIPT
// =========================================================================
export async function handleLoadStudentManagement() {
  const container = document.getElementById('studentManagementContainer') || document.getElementById('mainContentArea');
  if (!container) return;

  showAppLoading('⏳ Đang tải danh sách sinh viên...');
  try {
    const username = getLoggedInUsername();
    const role = getLoggedInRole();

    const res = await appsScriptService.request('GET_STUDENTS', { username, role });
    hideAppLoading();

    const students = res.students || res.data || [];
    renderStudentManagementUI(students);
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi nạp danh sách sinh viên: ${err.message}`);
  }
}

// =========================================================================
// 2. HIỂN THỊ BẢNG QUẢN LÝ SINH VIÊN
// =========================================================================
export function renderStudentManagementUI(students = []) {
  const container = document.getElementById('studentManagementContainer') || document.getElementById('mainContentArea');
  if (!container) return;

  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid var(--border); margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
        <h3 style="margin:0; font-size:18px; color:#0f172a;">👥 Quản Lý Sinh Viên (${students.length})</h3>
        <div style="display:flex; gap:10px;">
          <button type="button" onclick="handleOpenAssignExamModal()" style="background:#2563eb; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer;">
            📌 Gán Đề Thi Cho Lớp / SV
          </button>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
          <thead>
            <tr style="background:#f1f5f9; color:#334155;">
              <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Mã SV</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Họ và Tên</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Lớp</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Giảng Viên Phụ Trách</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1; text-align:center;">Thao Tác</th>
            </tr>
          </thead>
          <tbody>
            ${students.length === 0 ? `
              <tr><td colspan="5" style="padding:20px; text-align:center; color:#94a3b8;">Chưa có dữ liệu sinh viên nào.</td></tr>
            ` : students.map(st => `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:10px; font-weight:600; color:#0f172a;">${escapeHtml(st.studentCode)}</td>
                <td style="padding:10px;">${escapeHtml(st.fullName)}</td>
                <td style="padding:10px;"><span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:4px; font-weight:600; font-size:12px;">${escapeHtml(st.className || 'N/A')}</span></td>
                <td style="padding:10px; color:#64748b;">${escapeHtml(st.uploadedBy || 'admin')}</td>
                <td style="padding:10px; text-align:center;">
                  <button type="button" onclick="handleResetStudentPasswordUI('${st.studentCode}')" style="background:#d97706; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer; margin-right:4px;">🔑 Đổi mật khẩu</button>
                  <button type="button" onclick="handleDeleteStudentUI('${st.studentCode}')" style="background:#dc2626; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer;">🗑️ Xóa</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// =========================================================================
// 3. ĐẶT LẠI MẬT KHẨU CHO SINH VIÊN
// =========================================================================
export async function handleResetStudentPasswordUI(studentCode) {
  const newPassword = prompt(`Nhập Mật khẩu MỚI cho sinh viên [${studentCode}]:`);
  if (!newPassword || !newPassword.trim()) return;

  showAppLoading(`⏳ Đang đặt lại mật khẩu cho SV [${studentCode}]...`);
  try {
    const res = await appsScriptService.request('RESET_STUDENT_PASSWORD', {
      studentCode: studentCode,
      newPassword: newPassword.trim()
    });
    hideAppLoading();
    alert(res.message || '✅ Đã đổi mật khẩu thành công!');
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

// =========================================================================
// 4. XÓA SINH VIÊN KHỎI DANH SÁCH
// =========================================================================
export async function handleDeleteStudentUI(studentCode) {
  if (!confirm(`Bạn có chắc chắn muốn XÓA sinh viên [${studentCode}] khỏi danh sách?`)) return;

  showAppLoading(`⏳ Đang xóa sinh viên [${studentCode}]...`);
  try {
    const res = await appsScriptService.request('DELETE_STUDENT', { studentCode });
    hideAppLoading();
    alert(res.message || '✅ Đã xóa sinh viên thành công!');
    handleLoadStudentManagement();
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

// =========================================================================
// 5. GÁN ĐỀ THI CHO LỚP HOẶC SINH VIÊN
// =========================================================================
export async function handleOpenAssignExamModal() {
  const examId = prompt('Nhập Mã đề thi cần giao (Ví dụ: exam_75ceb91a):');
  if (!examId || !examId.trim()) return;

  const assignType = prompt('Nhập kiểu gán (CLASS = Gán theo Lớp, STUDENT = Gán 1 SV, ALL = Tất cả SV):', 'CLASS');
  if (!assignType) return;

  const cleanType = assignType.trim().toUpperCase();
  let targetValue = '';

  if (cleanType === 'CLASS') {
    targetValue = prompt('Nhập Tên Lớp cần giao (Ví dụ: BIO 101 A):');
    if (!targetValue) return;
  } else if (cleanType === 'STUDENT') {
    targetValue = prompt('Nhập Mã Sinh Viên cần giao (Ví dụ: 32217691039):');
    if (!targetValue) return;
  }

  showAppLoading(`⏳ Đang giao đề thi [${examId}]...`);
  try {
    const username = getLoggedInUsername();
    const res = await appsScriptService.request('ASSIGN_EXAM', {
      examId: examId.trim(),
      assignType: cleanType,
      targetValue: targetValue ? targetValue.trim() : '',
      assignedBy: username
    });
    hideAppLoading();
    alert(res.message || '✅ Đã giao đề thi thành công!');
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi giao đề: ${err.message}`);
  }
}

window.handleLoadStudentManagement = handleLoadStudentManagement;
window.handleResetStudentPasswordUI = handleResetStudentPasswordUI;
window.handleDeleteStudentUI = handleDeleteStudentUI;
window.handleOpenAssignExamModal = handleOpenAssignExamModal;
