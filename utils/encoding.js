/**
 * Thư viện xử lý mã hóa UTF-8 an toàn cho tiếng Việt và dữ liệu Base64
 */
export const utf8ToBase64 = (str) => {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(`0x${p1}`)
    )
  );
};

export const base64ToUtf8 = (str) => {
  return decodeURIComponent(
    atob(str)
      .split('')
      .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
      .join('')
  );
};
