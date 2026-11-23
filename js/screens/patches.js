// screens/patches.js: Catalog tab, Patches section. Grouped list with search; add and edit.
import { h, field, textInput, selectInput, toggleRow, segmented, searchBox, sheet, toast, withBusy, setChildren } from '../ui.js';
import { store, loadBootstrap, setCatalog } from '../store.js';
import { call, ApiError } from '../api.js';
import { catalogTabs, catalogNote } from './products.js';
import { pickPhoto, resizePhoto, photoSrc } from '../photos.js';
import { showError } from '../ui.js';

const GROUPS = ['Small and medium', 'Large and custom-ordered', 'Back-size (9 in and up)'];

let query = ''; // kept while switching tabs during this visit

export default {
  title: 'Catalog',
  tab: 'catalog',
  render(main) {
    const listWrap = h('div');

    const drawList = () => {
      const q = query.trim().toLowerCase();
      const all = store.data.patches;
      const shown = q
        ? all.filter((p) => p.patch_no.toLowerCase().replace(/^0+/, '').startsWith(q.replace(/^0+/, '')) ||
            p.name.toLowerCase().includes(q))
        : all;
      if (!shown.length) {
        setChildren(listWrap, h('div', { class: 'card empty' }, h('p', null, q ? 'No patch matches "' + query.trim() + '".' : 'No patches yet.')));
        return;
      }
      const groups = GROUPS.concat(shown.map((p) => p.group).filter((g) => !GROUPS.includes(g)));
      setChildren(listWrap, ...groups.map((g) => {
        const items = shown.filter((p) => p.group === g);
        if (!items.length) return null;
        return h('section', null,
          h('h2', { class: 'label group-label' }, g + ' (' + items.length + ')'),
          h('ul', { class: 'list' }, items.map((p) => h('li', { class: p.active ? '' : 'muted-row' },
            h('button', { type: 'button', class: 'list-row button-row', onclick: () => editPatch(p, drawList) },
              h('div', { class: 'grow' },
                h('div', { class: 'title-line' },
                  h('strong', null, 'No. ' + p.patch_no), p.name,
                  p.tier === 'premium' ? h('span', { class: 'badge badge-premium' }, 'Premium') : null,
                  p.active ? null : h('span', { class: 'badge badge-draft' }, 'Hidden')),
                p.size ? h('div', { class: 'small muted' }, p.size) : null),
              h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))));
      }).filter(Boolean));
    };

    const draw = () => {
      setChildren(main, 
        catalogTabs('patches'),
        catalogNote(),
        h('div', { class: 'toolbar' },
          searchBox('Number or name',(v) => { query = v; drawList(); }, query),
          h('button', { class: 'btn', type: 'button', onclick: () => editPatch(null, drawList) }, '+ Add')),
        listWrap);
      drawList();
    };

    draw();
    return async () => { await loadBootstrap(); drawList(); };
  }
};

/** Next free number after the highest numeric one, padded to 2 digits ("46"). */
function nextPatchNo() {
  const max = store.data.patches.reduce((m, p) => (/^\d+$/.test(p.patch_no) ? Math.max(m, parseInt(p.patch_no, 10)) : m), 0);
  return String(max + 1).padStart(2, '0');
}

function editPatch(patch, redraw) {
  sheet((close) => {
    let tier = patch ? patch.tier : 'standard';
    const no = textInput(patch ? patch.patch_no : nextPatchNo(), { maxlength: '10', inputmode: 'numeric', autocomplete: 'off' });
    const name = textInput(patch ? patch.name : '', { maxlength: '100', autocomplete: 'off' });
    const size = textInput(patch ? patch.size : '', { maxlength: '50', autocomplete: 'off', placeholder: 'e.g. 3 × 4 in' });
    const group = selectInput(GROUPS.map((g) => ({ value: g, label: g })), patch ? patch.group : GROUPS[0]);
    const tierCtl = segmented([{ value: 'standard', label: 'Standard' }, { value: 'premium', label: 'Premium' }],
      tier, (v) => { tier = v; }, 'Tier');
    const active = toggleRow('Show in the patch picker', patch ? patch.active : true);
    const save = h('button', { class: 'btn btn-block', type: 'submit' }, 'Save patch');
    return h('form', { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      withBusy(save, 'Saving…', async () => {
        if (!no.value.trim()) throw new ApiError('VALIDATION', 'Please give the patch a number.');
        if (!name.value.trim()) throw new ApiError('VALIDATION', 'Please give the patch a name.');
        const res = await call('catalog.savePatch', {
          original_patch_no: patch ? patch.patch_no : undefined,
          patch_no: no.value.trim(), name: name.value, size: size.value, tier, group: group.value, active: active.input.checked
        });
        setCatalog(res.catalog);
        toast('Patch saved');
        close();
        redraw();
      });
    } },
    h('h2', null, patch ? 'Patch No. ' + patch.patch_no : 'New patch'),
    field('Number', no),
    field('Name', name),
    field('Size (optional)', size),
    h('div', { class: 'field' }, h('span', null, 'Tier'), tierCtl),
    field('Group', group),
    active,
    patch ? patchPhotoBlock(patch) : h('p', { class: 'small muted' }, 'You can add a photo after saving the patch.'),
    h('div', { class: 'actions' }, save,
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => close() }, 'Cancel')));
  });
}

/** Photo for an existing patch: shows it and lets Terri add or replace it. */
function patchPhotoBlock(patch) {
  const img = h('img', { class: 'patch-photo', alt: 'Patch No. ' + patch.patch_no });
  const wrap = h('div', { class: 'patch-photo-wrap' });
  const btn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, patch.photo_file_id ? 'Replace photo' : '+ Add photo');
  let version = patch.photo_file_id;
  const show = () => {
    if (!version) { setChildren(wrap); return; }
    setChildren(wrap, h('div', { class: 'spinner', 'aria-label': 'Loading' }));
    photoSrc({ patch_no: patch.patch_no, v: version }, true).then((src) => { img.src = src; setChildren(wrap, img); })
      .catch(() => setChildren(wrap, h('p', { class: 'small muted' }, 'Photo unavailable.')));
  };
  btn.addEventListener('click', async () => {
    const file = await pickPhoto();
    if (!file) return;
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      const r = await call('photos.upload', { patch_no: patch.patch_no, data: await resizePhoto(file, 1000) });
      setCatalog(r.catalog);
      version = (r.catalog.patches.find((p) => p.patch_no === patch.patch_no) || {}).photo_file_id;
      toast('Photo saved');
      show();
      btn.textContent = 'Replace photo';
    } catch (err) {
      showError(err);
      btn.textContent = version ? 'Replace photo' : '+ Add photo';
    }
    btn.disabled = false;
  });
  show();
  return h('div', { class: 'field' }, h('span', null, 'Photo (optional)'), wrap, btn);
}
