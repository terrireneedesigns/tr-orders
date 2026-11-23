/**
 * Backup.gs: nightly copy of the Sheet into "TR Orders/Backups", keeping 30 days.
 */

var BACKUP_PREFIX = 'TR Orders Data ';
var BACKUP_KEEP_DAYS = 30;

/** Called by the nightly time-driven trigger (2:00 AM Phoenix) that setup() installs. */
function nightlyBackup() {
  runBackup_();
}

/** Copies the spreadsheet to Backups as "TR Orders Data YYYY-MM-DD" and trashes copies older than 30 days. */
function runBackup_() {
  var folder = backupsFolder_();
  var name = BACKUP_PREFIX + todayStr_();

  // One copy per day: a second run the same day replaces the earlier copy.
  var same = folder.getFilesByName(name);
  while (same.hasNext()) same.next().setTrashed(true);

  var ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  var copy = ssFile.makeCopy(name, folder);

  var cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400000;
  var removed = 0;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf(BACKUP_PREFIX) === 0 && f.getDateCreated().getTime() < cutoff) {
      f.setTrashed(true);
      removed++;
    }
  }
  return { name: name, url: copy.getUrl(), removed: removed };
}

function backupsFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('BACKUPS_FOLDER_ID');
  if (!id) throw appError('SETUP', 'The Backups folder is not set up. Run setup() in Apps Script.');
  return DriveApp.getFolderById(id);
}
