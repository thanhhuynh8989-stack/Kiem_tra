import { appsScriptService } from '../services/appsScriptService.js';
import { showAppLoading, hideAppLoading, getLoggedInUsername, escapeHtml } from './authAndCore.js';

/**
 * 1. TẢI VÀ RENDER TRANG QUẢN LÝ SINH VIÊN (CHỈ LẤY SINH VIÊN DO GIẢNG VIÊN NÀY UPLOAD)
 */
export async function handleLoadStudentManagement() {
  const container = document.getElementById('studentManagementContainer') || document.getElementById('mainContentArea');
  if (!container) return;

  // Kiểm tra nếu không ở Tab Sinh viên thì không tiến hành render
  if (window.currentActiveTab && window.currentActiveTab !== 'tab-students') return;

  const currentLecturer = getLoggedInUsername();

  try {
    const res = await appsScriptService.request('GET_STUDENTS', {
      uploadedBy: currentLecturer
    });

    if (window.currentActiveTab && window.currentActiveTab !== 'tab-students') return;

    const students = (res && res.students) ? res.students : [];
    renderStudentManagementUI(students, container);

  } catch (err) {
    container.innerHTML = `<div style="padding:20px; color:#ef4444;">⚠️ Lỗi tải danh sách sinh viên: ${escapeHtml(err.message)}</div>`;
  }
}

/**
 * 2. RENDER KHUNG GIAO DIỆN (UPLOAD FILE + BẢNG SINH VIÊN)
 */
export function renderStudentManagementUI(students = [], container) {
  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid #e2e8f0; margin-top:16px;">
      
      <!-- KHU VỰC 1: TẢI LÊN FILE DANH SÁCH SINH VIÊN -->
      <div style="background:#f8fafc; border:2px dashed #cbd5e1; border-radius:8px; padding:20px; text-align:center; margin-bottom:20px;">
        <h4 style="margin:0 0 8px 0; color:#0f172a; font-size:16px;">📥 Tải Lên Danh Sách Sinh Viên (Excel / CSV)</h4>
        <p style="margin:0 0 14px 0; font-size:13px; color:#64748b;">
          Chọn tệp <code>.xlsx</code>, <code>.xls</code> hoặc <code>.csv</code> chứa các cột: <strong>Mã SV, Họ và Tên, Lớp, Email</strong>
        </p>

        <div style="display:flex; justify-content:center; align-items:center; gap:10px; flex-wrap:wrap;">
          <input type="file" id="studentListFileInput" accept=".xlsx, .xls, .csv" style="display:none;" onchange="handleStudentFileSelected(event)">
          
          <button type="button" onclick="document.getElementById('studentListFileInput').click()" style="background:#2563eb; color:#fff; border:none; padding:9px 18px; border-radius:6px; font-weight:600; font-size:13px; cursor:pointer;">
            📁 Chọn Tệp Excel / CSV
          </button>
        </div>
        <div id="selectedFileName" style="margin-top:10px; font-size:13px; color:#0284c7; font-weight:600;"></div>
      </div>

      <!-- KHU VỰC 2: BẢNG DANH SÁCH SINH VIÊN -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
        <h3 style="margin:0; font-size:18px; color:#0f172a;">👥 Danh Sách Sinh Viên (${students.length})</h3>
        <button type="button" onclick="handleLoadStudentManagement()" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:13px;">
          🔄 Tải lại
        </button>
      </div>

      ${students.length === 0 
        ? '<div style="text-align:center; padding:30px; color:#64748b;">📭 Chưa có sinh viên nào do bạn quản lý. Vui lòng tải lên file Excel.</div>'
        : renderStudentTable(students)
      }
    </div>
  `;

  container.innerHTML = html;
}

/**
 * 3. RENDER BẢNG DỮ LIỆU SINH VIÊN
 */
function renderStudentTable(students = []) {
  return `
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
        <thead>
          <tr style="background:#f1f5f9; color:#334155;">
            <th style="padding:10px; border-bottom:2px solid #cbd5e1;">STT</th>
            <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Mã SV</th>
            <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Họ và Tên</th>
            <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Lớp</th>
            <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Email / SĐT</th>
            <th style="padding:10px; border-bottom:2px solid #cbd5e1; text-align:center;">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          ${students.map((st, idx) => `
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:10px; color:#64748b;">${idx + 1}</td>
              <td style="padding:10px; font-weight:600; color:#2563eb;">${escapeHtml(st.studentId || st.username || '')}</td>
              <td style="padding:10px; color:#0f172a; font-weight:600;">${escapeHtml(st.fullName || st.name || '')}</td>
              <td style="padding:10px; color:#475569; font-weight:600;">${escapeHtml(st.className || st.class || 'N/A')}</td>
              <td style="padding:10px; color:#64748b;">${escapeHtml(st.email || st.phone || '')}</td>
              <td style="padding:10px; text-align:center;">
                <button type="button" onclick="resetStudentPassword('${escapeHtml(st.studentId || st.username)}')" style="background:#f59e0b; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer; margin-right:4px;">
                  🔑 Reset MK
                </button>
                <button type="button" onclick="deleteStudent('${escapeHtml(st.studentId || st.username)}')" style="background:#ef4444; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer;">
                  🗑️ Xóa
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * 4. XỬ LÝ KHI CHỌN FILE EXCEL / CSV TẢI LÊN (GỬI KÈM THÔNG TIN GIẢNG VIÊN UPLOAD)
 */
export async function handleStudentFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const currentLecturer = getLoggedInUsername();

  const selectedFileNameEl = document.getElementById('selectedFileName');
  if (selectedFileNameEl) {
    selectedFileNameEl.innerText = `📄 Đang xử lý tệp: ${file.name}`;
  }

  showAppLoading(`⏳ Đang tải lên danh sách sinh viên cho giảng viên [${currentLecturer}]...`);

  try {
    const reader = new FileReader();
    reader.onload = async function (e) {
      const base64Data = e.target.result.split(',')[1];

      const res = await appsScriptService.request('UPLOAD_EXCEL_DRIVE', {
        fileName: file.name,
        fileData: base64Data,
        mimeType: file.type,
        uploadedBy: currentLecturer
      });

      hideAppLoading();

      if (res && (res.status === 'success' || res.success)) {
        alert(`🎉 Tải lên danh sách sinh viên thành công!`);
        handleLoadStudentManagement();
      } else {
        alert(`⚠️ Lỗi tải danh sách: ${res?.message || 'Không thể cập nhật danh sách sinh viên'}`);
      }
    };

    reader.readAsDataURL(file);

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi đọc tệp: ${err.message}`);
  }
}

/**
 * 5. RESET MẬT KHẨU SINH VIÊN
 */
export async function resetStudentPassword(studentId) {
  if (!confirm(`Bạn có chắc muốn cấp lại mật khẩu mặc định cho sinh viên [${studentId}] không?`)) return;

  showAppLoading(`⏳ Đang đặt lại mật khẩu cho [${studentId}]...`);

  try {
    const res = await appsScriptService.request('RESET_STUDENT_PASSWORD', { studentId });
    hideAppLoading();

    if (res && res.status === 'success') {
      alert(`🔑 Mật khẩu của sinh viên [${studentId}] đã được đặt lại thành công!`);
    } else {
      alert(`Không thể đặt lại mật khẩu: ${res?.message || 'Lỗi hệ thống'}`);
    }
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

/**
 * 6. XÓA SINH VIÊN
 */
export async function deleteStudent(studentId) {
  if (!confirm(`Bạn có chắc chắn muốn xóa sinh viên [${studentId}] khỏi hệ thống?`)) return;

  showAppLoading(`⏳ Đang xóa sinh viên [${studentId}]...`);

  try {
    const res = await appsScriptService.request('DELETE_STUDENT', { studentId });
    hideAppLoading();

    if (res && res.status === 'success') {
      alert('🗑️ Đã xóa sinh viên thành công!');
      handleLoadStudentManagement();
    } else {
      alert(`Không thể xóa sinh viên: ${res?.message || 'Lỗi hệ thống'}`);
    }
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

// Khai báo global window cho sự kiện HTML inline
window.handleLoadStudentManagement = handleLoadStudentManagement;
window.handleStudentFileSelected = handleStudentFileSelected;
window.resetStudentPassword = resetStudentPassword;
window.deleteStudent = deleteStudent;
