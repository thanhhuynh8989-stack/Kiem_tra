// =========================================================================
// MODULE XỬ LÝ OFFLINE, BẢN NHÁP & NẠP BÀI DỰ PHÒNG KHẨN CẤP
// =========================================================================

const SECRET_SALT = "ONLINE_EXAM_SECURE_HASH_2026_@KEY";

/**
 * 1. TẠO MÃ CHECK_SUM CHỐNG SỬA ĐỔI DỮ LIỆU BẰNG DEVTOOLS
 */
export function generateChecksum(dataObject) {
  const str = JSON.stringify({
    examId: dataObject.examId,
    studentCode: dataObject.studentCode,
    answers: dataObject.answers,
    violationCount: dataObject.violationCount,
    submittedAtClient: dataObject.submittedAtClient
  }) + SECRET_SALT;

  // Simple Hash algorithm (hoặc dùng Web Crypto API)
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return "CHK_" + Math.abs(hash).toString(36);
}

/**
 * 2. LƯU BẢN NHÁP TỰ ĐỘNG VÀO LOCAL_STORAGE
 */
export function saveExamDraftToLocal(examId, studentCode, answers, violationCount, submittedAtClient = null) {
  const draftData = {
    examId,
    studentCode,
    answers,
    violationCount,
    submittedAtClient: submittedAtClient || Date.now(),
    lastSavedAt: Date.now()
  };
  draftData.checksum = generateChecksum(draftData);

  const key = `exam_draft_${studentCode}_${examId}`;
  localStorage.setItem(key, JSON.stringify(draftData));
}

/**
 * 3. XUẤT FILE DỰ PHÒNG KHẨN CẤP (.DAT) CHO SINH VIÊN KHI MẠNG SẬP
 */
export function exportEmergencyFile(examId, studentCode, studentName, answers, violationCount) {
  const payload = {
    examId,
    studentCode,
    studentName,
    answers,
    violationCount,
    submittedAtClient: Date.now()
  };
  payload.checksum = generateChecksum(payload);

  // Mã hóa Base64 chống xem và sửa nhanh
  const encodedContent = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const blob = new Blob([encodedContent], { type: "application/octet-stream" });
  
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `BAILAM_DUPHONG_${studentCode}_${examId}.dat`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 4. HÀM DÀNH CHO GIẢNG VIÊN: ĐỌC VÀ XÁC THỰC FILE DỰ PHÒNG (.DAT)
 */
export async function parseAndVerifyEmergencyFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const rawBase64 = e.target.result;
        const decodedJsonStr = decodeURIComponent(escape(atob(rawBase64)));
        const data = JSON.parse(decodedJsonStr);

        // Kiểm tra Checksum tính toàn vẹn
        const expectedChecksum = generateChecksum(data);
        if (data.checksum !== expectedChecksum) {
          reject("⚠️ File bài làm bị từ chối! Dữ liệu đã bị chỉnh sửa hoặc vi phạm tính toàn vẹn.");
          return;
        }

        resolve(data); // Trả về bài làm an toàn
      } catch (err) {
        reject("❌ Cấu trúc File không hợp lệ hoặc bị lỗi định dạng!");
      }
    };
    reader.readAsText(file);
  });
}
