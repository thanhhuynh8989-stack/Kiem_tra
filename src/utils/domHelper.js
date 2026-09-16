import { logger } from './logger.js';

/

DOM Rendering and Formatting Utilities
*/

/

Batches KaTeX rendering using DocumentFragment or element query to avoid continuous Reflow/Repaint.
*/
export function renderMathInContainer(containerElement) {
if (!containerElement) return;

if (window.renderMathInElement) {
try {
window.renderMathInElement(containerElement, {
delimiters: [
{ left: '

$$', right: '$$

', display: true },
{ left: '$', right: '$', display: false },
{ left: '\(', right: '\)', display: false },
{ left: '\[', right: '\]', display: true }
],
throwOnError: false
});
} catch (err) {
logger.error('Lỗi khi render công thức KaTeX:', err);
}
} else {
logger.warn('Thư viện KaTeX auto-render chưa được nạp.');
}
}

/

Escapes unsafe HTML characters to prevent XSS attacks.
*/
export function sanitizeHTML(str) {
if (!str) return '';
const div = document.createElement('div');
div.innerText = str;
return div.innerHTML;
}

/

Helper to construct DOM elements concisely.
*/
export function createElement(tag, attributes = {}, children = []) {
const element = document.createElement(tag);

Object.entries(attributes).forEach(([key, value]) => {
if (key === 'className') {
element.className = value;
} else if (key === 'innerHTML') {
element.innerHTML = value;
} else if (key.startsWith('on') && typeof value === 'function') {
element.addEventListener(key.substring(2).toLowerCase(), value);
} else {
element.setAttribute(key, value);
}
});

children.forEach((child) => {
if (typeof child === 'string') {
element.appendChild(document.createTextNode(child));
} else if (child instanceof HTMLElement) {
element.appendChild(child);
}
});

return element;
}
