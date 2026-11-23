/**
 * Photos.gs: reference photos for orders, and optional patch photos for the catalog (SPEC 4.7, 4.13, 10).
 * Files stay private in Drive (TR Orders/Order Photos/<number>/ and TR Orders/Patch Photos/).
 * The admin app gets them through photos.get; the customer page never shows photos.
 * The app resizes photos to 1600 px JPEG before upload.
 */

var MAX_PHOTO_BASE64 = 8 * 1024 * 1024; // about 6 MB of image
var PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function photoBlob_(p, name) {
  var data = String(p.data || '');
  var mime = String(p.mime || 'image/jpeg');
  var m = data.match(/^data:([^;]+);base64,/);
  if (m) { mime = m[1]; data = data.slice(m[0].length); }
  if (PHOTO_TYPES.indexOf(mime) === -1) throw appError('VALIDATION', 'Please choose a photo (JPEG or PNG).');
  if (!data || data.length > MAX_PHOTO_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    throw appError('VALIDATION', 'That photo is too large or not a photo.');
  }
  var ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
  return Utilities.newBlob(Utilities.base64Decode(data), mime, name + ext);
}

function rootFolder_() {
  var root = existingFolder_(PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID'));
  if (!root) throw appError('SETUP', 'The TR Orders Drive folder is missing. Run setup() in Apps Script.');
  return root;
}

function orderPhotosFolder_(number) {
  var base = existingFolder_(PropertiesService.getScriptProperties().getProperty('PHOTOS_FOLDER_ID')) || childFolder_(rootFolder_(), 'Order Photos');
  return childFolder_(base, number);
}

function photoRows_(docId) {
  return readTable_('Photos').filter(function (x) { return x.doc_id === docId; }).map(clean_);
}

/**
 * photos.upload: { doc_id, item_id?, data, mime?, caption? } or { patch_no, data, mime? }
 * Order photos return { photos } for that order; patch photos return { catalog }.
 */
function uploadPhoto_(p) {
  var caption = vStr_(p.caption, 'Caption', 200);
  if (p.patch_no) {
    var patchNo = vStr_(p.patch_no, 'Patch number', 10, true);
    var patch = findBy_(readTable_('Patches'), 'patch_no', patchNo);
    if (!patch) throw appError('NOT_FOUND', 'That patch no longer exists.');
    var pfile = childFolder_(rootFolder_(), 'Patch Photos').createFile(photoBlob_(p, 'Patch ' + patchNo));
    return withLock_(function () {
      var row = findBy_(readTable_('Patches'), 'patch_no', patchNo);
      if (!row) throw appError('NOT_FOUND', 'That patch no longer exists.');
      var old = row.photo_file_id;
      row.photo_file_id = pfile.getId();
      updateRow_('Patches', row);
      if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (err) { /* already gone */ } }
      return { catalog: freshCatalog_() };
    });
  }

  var docId = vId_(p.doc_id, 'Order');
  var doc = findBy_(readTable_('Documents'), 'doc_id', docId);
  if (!doc) throw appError('NOT_FOUND', 'That order no longer exists.');
  if (doc.status === 'void') throw appError('VALIDATION', 'This order is void.');
  var itemId = p.item_id ? String(p.item_id) : '';
  if (itemId && !readTable_('DocItems').some(function (it) { return it.doc_id === docId && it.item_id === itemId; })) itemId = '';
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmmss');
  var file = orderPhotosFolder_(doc.number).createFile(photoBlob_(p, doc.number + ' ' + stamp));
  return withLock_(function () {
    appendRows_('Photos', [{
      photo_id: newId_('PH'), doc_id: docId, item_id: itemId, drive_file_id: file.getId(), caption: caption, created_at: nowIso_()
    }]);
    return { photos: photoRows_(docId) };
  });
}

/** photos.get: { photo_id } or { patch_no }, thumb? -> { mime, data (base64) } */
function getPhoto_(p) {
  var fileId;
  if (p.patch_no) {
    var patch = findBy_(readTable_('Patches'), 'patch_no', String(p.patch_no));
    fileId = patch && patch.photo_file_id;
  } else {
    var row = findBy_(readTable_('Photos'), 'photo_id', vId_(p.photo_id, 'Photo'));
    fileId = row && row.drive_file_id;
  }
  if (!fileId) throw appError('NOT_FOUND', 'That photo wasn\'t found.');
  var file;
  try { file = DriveApp.getFileById(fileId); } catch (err) { throw appError('NOT_FOUND', 'That photo is no longer in Drive.'); }
  var blob = null;
  if (p.thumb) { try { blob = file.getThumbnail(); } catch (err) { blob = null; } }
  if (!blob) blob = file.getBlob();
  return { mime: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) };
}

/** photos.delete: { photo_id } -> { photos }. The file goes to the Drive trash. */
function deletePhoto_(p) {
  var id = vId_(p.photo_id, 'Photo');
  return withLock_(function () {
    var row = findBy_(readTable_('Photos'), 'photo_id', id);
    if (!row) throw appError('NOT_FOUND', 'That photo was already removed.');
    try { DriveApp.getFileById(row.drive_file_id).setTrashed(true); } catch (err) { /* already gone */ }
    deleteRowsWhere_('Photos', 'photo_id', id);
    return { photos: photoRows_(row.doc_id) };
  });
}
