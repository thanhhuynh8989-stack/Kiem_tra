├── index.html                  # Giao diện người dùng (Học sinh & Giảng viên)
├── README.md                   # Tài liệu hướng dẫn hệ thống
├── backend/
│   └── Code.gs                 # Google Apps Script Backend Gateway & Proxy
└── src/
    ├── app.js                  # File khởi tạo và điều phối giao diện chính
    ├── constants/
    │   ├── apiEndpoints.js     # Hằng số Endpoints
    │   └── appConfig.js        # Cấu hình hệ thống, Regex & Enums
    ├── models/
    │   └── examModel.js        # Chuẩn hóa đề thi, sinh UUID & tách Master Key
    ├── parsers/
    │   ├── docxParser.js       # Bóc tách nội dung từ file Microsoft Word (.docx)
    │   └── pdfParser.js        # Bóc tách văn bản/OCR hình ảnh từ file PDF
    ├── services/
    │   ├── appsScriptService.js# Kết nối Google Apps Script Backend (CORS Safe)
    │   ├── geminiService.js    # AI OCR & Convert KaTeX qua Gemini API
    │   └── githubService.js    # Đọc/ghi dữ liệu công khai trên GitHub Repository
    └── utils/
        ├── domHelper.js        # Hỗ trợ render KaTeX & tối ưu DOM Batching
        ├── encoding.js         # Mã hóa UTF-8 sang Base64 an toàn cho tiếng Việt
        ├── errorHandler.js     # Xử lý lỗi & cơ chế thử lại (Exponential Backoff)
        ├── imageCompressor.js  # Tự động nén ảnh Base64 tối ưu dung lượng
        └── logger.js           # Thư viện ghi log hệ thống chuyên nghiệp
