import { appsScriptService } from '../services/appsScriptService.js';
import { showAppLoading, hideAppLoading, getLoggedInUsername, escapeHtml } from './authAndCore.js';

/**
 * TỰ ĐỘNG TẢI THƯ VIỆN SHEETJS (XLSX) NẾU TRUY CẬP LẦN ĐẦU
 */
async function loadSheetJS() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('Không thể nạp thư viện đọc file Excel XLSX!'));
    document.head.appendChild(script);
  });
}

// =========================================================================
// I. TẦNG GIAO DIỆN (UI RENDERING LAYER)
// =========================================================================

/**
 * Render Khung Giao Diện Quản Lý Sinh Viên
 */
export function renderStudentManagementUI(students = [], container) {
  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid #e2e8f0; margin-top:16px;">
      
      <!-- KHU VỰC TẢI LÊN FILE EXCEL/CSV & TẢI FILE MẪU -->
      <div style="background:#f8fafc; border:2px dashed #cbd5e1; border-radius:8px; padding:20px; text-align:center; margin-bottom:20px;">
        <h4 style="margin:0 0 8px 0; color:#0f172a; font-size:16px;">📥 Tải Lên Danh Sách Sinh Viên (Excel / CSV)</h4>
        <p style="margin:0 0 14px 0; font-size:13px; color:#64748b;">
          Chọn tệp <code>.xlsx</code>, <code>.xls</code> hoặc <code>.csv</code> chứa các cột: <strong>Mã SV, Họ và Tên, Lớp, Mật Khẩu/Email</strong>
        </p>

        <div style="display:flex; justify-content:center; align-items:center; gap:10px; flex-wrap:wrap;">
          <button type="button" onclick="downloadStudentTemplateCSV()" style="background:#0d9488; color:#fff; border:none; padding:9px 16px; border-radius:6px; font-weight:600; font-size:13px; cursor:pointer;">
            📥 Tải File Mẫu (.csv)
          </button>
          
          <input type="file" id="studentListFileInput" accept=".xlsx, .xls, .csv" style="display:none;" onchange="handleStudentFileSelected(event)">
          
          <button type="button" onclick="document.getElementById('studentListFileInput').click()" style="background:#2563eb; color:#fff; border:none; padding:9px 18px; border-radius:6px; font-weight:600; font-size:13px; cursor:pointer;">
            📁 Chọn Tệp Upload
          </button>
        </div>
        <div id="selectedFileName" style="margin-top:10px; font-size:13px; color:#0284c7; font-weight:600;"></div>
      </div>

      <!-- BẢNG DỮ LIỆU SINH VIÊN VÀ NÚT TẢI LẠI -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
        <h3 style="margin:0; font-size:18px; color:#0f172a;">👥 Danh Sách Sinh Viên Quản Lý (${students.length})</h3>
        <button type="button" onclick="handleLoadStudentManagement()" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; padding:8px 14px; border-radius:6px; cursor:pointer; font-size:13px; font-weight:600;">
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
 * Render Bảng Chi Tiết Sinh Viên (Ẩn 100% Mật Khẩu thành ••••••)
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
            <th style="padding:10px; border-bottom:2px solid #cbd5e1; text-align:center;">Mật Khẩu</th>
            <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Email</th>
            <th style="padding:10px; border-bottom:2px solid #cbd5e1; text-align:center;">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          ${students.map((st, idx) => `
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:10px; color:#64748b;">${idx + 1}</td>
              <td style="padding:10px; font-weight:600; color:#2563eb;">${escapeHtml(st.studentId || '')}</td>
              <td style="padding:10px; color:#0f172a; font-weight:600;">${escapeHtml(st.fullName || '')}</td>
              <td style="padding:10px; color:#475569; font-weight:600;">${escapeHtml(st.className || 'N/A')}</td>
              <td style="padding:10px; text-align:center; color:#64748b; font-weight:bold; letter-spacing:2px;">••••••</td>
              <td style="padding:10px; color:#64748b;">${escapeHtml(st.email || '--')}</td>
              <td style="padding:10px; text-align:center;">
                <button type="button" onclick="resetStudentPassword('${escapeHtml(st.studentId)}')" style="background:#f59e0b; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer; margin-right:4px;">
                  🔑 Reset MK
                </button>
                <button type="button" onclick="deleteStudent('${escapeHtml(st.studentId)}')" style="background:#ef4444; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer;">
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

// =========================================================================
// II. TẦNG XỬ LÝ THỰC THI (EXECUTION LOGIC LAYER)
// =========================================================================

/**
 * 1. Nạp danh sách sinh viên từ Server
 */
export async function handleLoadStudentManagement() {
  const container = document.getElementById('studentManagementContainer') || 
                    document.getElementById('mainContentArea');
  if (!container) return;

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
 * 2. Tải File Excel Mẫu (.xlsx) Chuẩn Định Dạng
 */
export function downloadStudentTemplateXLSX() {
  // Lấy thư viện XLSX từ import hoặc window.XLSX (nếu nhúng qua CDN)
  const XLSXLib = typeof XLSX !== 'undefined' ? XLSX : window.XLSX;

  if (!XLSXLib) {
    alert('⚠️ Chưa nạp thư viện XLSX. Vui lòng kiểm tra lại kết nối hoặc thẻ script XLSX!');
    return;
  }

  // Dữ liệu mẫu chuẩn cấu trúc 5 cột
  const sampleData = [
    {
      "Mã Sinh Viên": "SV001",
      "Họ Và Tên": "Nguyễn Văn A",
      "Lớp Học": "CNTT1",
      "Mật Khẩu": "123456",
      "Email": "nguyenvana@gmail.com"
    },
    {
      "Mã Sinh Viên": "SV002",
      "Họ Và Tên": "Trần Thị B",
      "Lớp Học": "CNTT1",
      "Mật Khẩu": "123456",
      "Email": "tranthib@gmail.com"
    }
  ];

  // 1. Tạo Sheet từ mảng dữ liệu JSON
  const worksheet = XLSXLib.utils.json_to_sheet(sampleData);

  // 2. Tùy chỉnh độ rộng cột (Width) giúp hiển thị đẹp mắt trong Excel
  worksheet['!cols'] = [
    { wch: 16 }, // Mã Sinh Viên
    { wch: 25 }, // Họ Và Tên
    { wch: 15 }, // Lớp Học
    { wch: 15 }, // Mật Khẩu
    { wch: 30 }  // Email
  ];

  // 3. Tạo Workbook và gắn Sheet vào
  const workbook = XLSXLib.utils.book_new();
  XLSXLib.utils.book_append_sheet(workbook, worksheet, "DanhSachSinhVien");

  // 4. Xuất file về máy người dùng dạng .xlsx
  XLSXLib.writeFile(workbook, 'Mau_Danh_Sach_Sinh_Vien.xlsx');
}

/**
 * 3. Đọc File Excel bằng SheetJS và Gửi lên Server
 */
export async function handleStudentFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const currentLecturer = getLoggedInUsername();
  const selectedFileNameEl = document.getElementById('selectedFileName');
  if (selectedFileNameEl) {
    selectedFileNameEl.innerText = `📄 Đang bóc tách tệp: ${file.name}`;
  }

  showAppLoading(`⏳ Đang xử lý file [${file.name}]...`);

  try {
    const XLSX = await loadSheetJS();
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      hideAppLoading();
      alert('Tệp Excel rỗng hoặc không có dữ liệu!');
      return;
    }

    const defaultClassName = file.name.replace(/\.[^/.]+$/, '').replace(/DS_?/i, '');

    const parsedStudents = rawRows.map(row => {
      const getVal = (keys) => {
        const foundKey = Object.keys(row).find(k => keys.some(key => k.trim().toLowerCase() === key.toLowerCase()));
        return foundKey ? String(row[foundKey]).trim() : '';
      };

      const studentId = getVal(['Mã SV', 'Mã Sinh viên', 'Ma SV', 'Username', 'MSSV']);
      const fullName = getVal(['Họ và Tên', 'Họ và tên', 'FullName', 'Name']);
      const className = getVal(['Lớp', 'Class', 'Lớp học']) || defaultClassName;
      const pass = getVal(['Pass', 'Password', 'Mật khẩu']);
      const email = getVal(['Email']);

      return {
        studentId: studentId,
        fullName: fullName,
        className: className,
        pass: pass || '123456',
        email: email
      };
    }).filter(s => s.studentId && s.fullName);

    if (parsedStudents.length === 0) {
      hideAppLoading();
      alert('Không tìm thấy dòng dữ liệu sinh viên nào hợp lệ!');
      return;
    }

    showAppLoading(`⏳ Đang lưu ${parsedStudents.length} sinh viên vào hệ thống...`);

    const res = await appsScriptService.request('IMPORT_STUDENT_LIST', {
      studentList: parsedStudents,
      uploadedBy: currentLecturer
    });

    hideAppLoading();

    if (res && (res.status === 'success' || res.success)) {
      alert(`🎉 Đã nạp thành công ${parsedStudents.length} sinh viên!`);
      handleLoadStudentManagement();
    } else {
      alert(`⚠️ Lỗi lưu danh sách: ${res?.message || 'Không thể cập nhật danh sách sinh viên'}`);
    }

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi đọc tệp Excel: ${err.message}`);
  }
}

/**
 * 4. Reset Mật Khẩu Mặc Định
 */
export async function resetStudentPassword(studentId) {
  if (!confirm(`Bạn có chắc muốn cấp lại mật khẩu mặc định (123456) cho sinh viên [${studentId}]?`)) return;

  showAppLoading(`⏳ Đang đặt lại mật khẩu...`);
  try {
    const res = await appsScriptService.request('RESET_STUDENT_PASSWORD', { studentId });
    hideAppLoading();
    if (res && res.status === 'success') {
      alert(`🔑 Đã reset mật khẩu của [${studentId}] về mặc định (123456)!`);
    } else {
      alert(`Lỗi: ${res?.message || 'Không thể đặt lại mật khẩu'}`);
    }
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

/**
 * 5. Xóa Sinh Viên
 */
export async function deleteStudent(studentId) {
  if (!confirm(`Bạn có chắc chắn muốn xóa sinh viên [${studentId}]?`)) return;

  showAppLoading(`⏳ Đang xóa sinh viên [${studentId}]...`);
  try {
    const res = await appsScriptService.request('DELETE_STUDENT', { studentId });
    hideAppLoading();
    if (res && res.status === 'success') {
      alert('🗑️ Đã xóa sinh viên thành công!');
      handleLoadStudentManagement();
    } else {
      alert(`Lỗi: ${res?.message || 'Không thể xóa sinh viên'}`);
    }
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

// Window Bindings
window.handleLoadStudentManagement = handleLoadStudentManagement;
window.handleStudentFileSelected = handleStudentFileSelected;
window.downloadStudentTemplateXLSX = downloadStudentTemplateXLSX;
window.resetStudentPassword = resetStudentPassword;
window.deleteStudent = deleteStudent;
