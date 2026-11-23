// photos.js: choose a photo (camera or library), shrink it on the phone, and load private photos.
// Photos are resized to at most 1600 px and saved as JPEG (about 0.8 quality) before upload (SPEC 12).
import { call } from './api.js';

/** Open the iPhone photo chooser (Take Photo / Photo Library). Resolves with a File, or null. */
export function pickPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let settled = false;
    const finish = (file) => { if (!settled) { settled = true; input.remove(); resolve(file); } };
    input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (err) { /* fall back below */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn\'t a photo the app can read.')); };
    img.src = url;
  });
}

/** Shrink to fit max×max and return a JPEG data URL. */
export async function resizePhoto(file, max = 1600, quality = 0.8) {
  const img = await loadImage(file);
  const w = img.width || img.naturalWidth;
  const ht = img.height || img.naturalHeight;
  const scale = Math.min(1, max / Math.max(w, ht));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(ht * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background instead of black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (img.close) img.close();
  return canvas.toDataURL('image/jpeg', quality);
}

const cache = new Map();

/** A private photo as a data URL, loaded through the signed-in app. `ref` is { photo_id } or { patch_no }. */
export async function photoSrc(ref, thumb = false) {
  const key = (ref.photo_id || 'patch:' + ref.patch_no + ':' + (ref.v || '')) + (thumb ? ':t' : '');
  if (cache.has(key)) return cache.get(key);
  const res = await call('photos.get', { ...ref, v: undefined, thumb });
  const src = 'data:' + res.mime + ';base64,' + res.data;
  cache.set(key, src);
  return src;
}
