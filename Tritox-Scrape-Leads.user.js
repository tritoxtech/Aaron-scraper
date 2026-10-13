// ==UserScript==
// @name         Tritox - New Leads Export
// @version      1.4.0
// @description  Export the selected New Leads stage to the Aaron sheet layout.
// @match        https://app.agencyzoom.com/referral/pipeline*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// Run in the AgencyZoom console, or install as a Tampermonkey script.
// Select Home and Auto Pipeline > Babu FIRST. This script retains your filters.
// It reads cards and clicks pagination only. No lead edits or messages.
(() => {
  'use strict';
  if (location.hostname !== 'app.agencyzoom.com' || !location.pathname.startsWith('/referral/pipeline')) {
    alert('Open the AgencyZoom pipeline page first.'); return;
  }
  if (document.getElementById('tritox-lead-export')) return;
  const panel = document.createElement('section');
  panel.id = 'tritox-lead-export';
  panel.style.cssText = 'position:fixed;right:16px;top:80px;width:340px;max-height:85vh;overflow:auto;z-index:2147483647;background:white;color:#172b4d;border:2px solid #245be0;border-radius:12px;padding:16px;box-shadow:0 6px 30px #0004;font:14px/1.5 Arial';
  panel.innerHTML = `<b>Tritox · New Leads Export</b>
    <p>Select <b>Home and Auto Pipeline → Babu</b> before starting. Keep filters unchanged while collecting.</p>
    <label><input id="tx-confirm" type="checkbox"> Both filters above are selected</label>
    <p><label>Sheet date <input id="tx-date" type="date"></label></p>
    <p><label>Staff (optional) <input id="tx-staff" placeholder="Leave blank or enter staff name"></label></p>
    <p><label>Account name (optional) <input id="tx-account" placeholder="Enter your sheet's account name"></label></p>
    <label>Existing Lead IDs from sheet column M (optional)</label>
    <textarea id="tx-existing" rows="3" style="width:100%;box-sizing:border-box" placeholder="Paste column M here to skip IDs already in your sheet"></textarea>
    <p><button id="tx-start">Collect all pages</button> <button id="tx-stop" disabled>Stop</button> <button id="tx-close">Close</button></p>
    <p id="tx-status" role="status">Ready. Column N shows Indiana for the INDIANA lead tag; all leads are included.</p>
    <p><button id="tx-copy" disabled>Copy for Sheet</button> <button id="tx-csv" disabled>Download CSV</button></p>
    <textarea id="tx-output" readonly rows="3" style="display:none;width:100%;box-sizing:border-box"></textarea>
    <small>Copy has no header and uses columns A–N. Indiana is shown in N when its tag is present. Paste into column A of a completely empty row. Existing rows are not checked unless you paste their IDs above.</small>`;
  panel.style.display = 'none';
  document.body.append(panel);
  const launcher = document.createElement('button');
  launcher.id = 'tritox-scrape-leads-button';
  launcher.type = 'button';
  launcher.textContent = 'Scrape Leads';
  launcher.setAttribute('aria-controls', panel.id);
  launcher.setAttribute('aria-expanded', 'false');
  launcher.style.cssText = 'position:fixed;left:334px;top:18px;z-index:2147483647;width:230px;max-width:calc(100vw - 350px);border:0;border-radius:8px;padding:10px 20px;background:#245be0;color:white;font:bold 14px Arial;cursor:pointer;box-shadow:0 2px 8px #0002';
  function showPanel(show) {
    panel.style.display = show ? 'block' : 'none';
    launcher.setAttribute('aria-expanded', String(show));
  }
  launcher.onclick = () => showPanel(panel.style.display === 'none');
  document.body.append(launcher);
  panel.querySelectorAll('button').forEach(button => { button.type = 'button'; });
  const $ = s => panel.querySelector(s);
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const safe = s => /^[=+@-]/.test(s) ? "'" + s : s;
  const today = new Date();
  $('#tx-date').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const column = () => {
    const el = document.getElementById('referral-407590');
    if (!el || clean(el.querySelector('.dd-header h2')?.textContent) !== 'New Leads') throw Error('Expected New Leads column was not found. Select the correct pipeline.');
    return el;
  };
  function snapshot() {
    const el = column();
    const match = clean(el.querySelector('.dd-pagination span')?.textContent).match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!match) throw Error('Could not read the page number.');
    const countText = clean(el.querySelector('.dd-header-counter h4')?.textContent).replace(/,/g,'');
    if (!/^\d+$/.test(countText)) throw Error('Could not read total lead count.');
    const cards = [...el.querySelectorAll('.dd-cards .dd-card[data-id]')].map(card => ({
      id: card.dataset.id, name: clean(card.querySelector('a.customer')?.textContent),
      indiana: [...card.querySelectorAll('.az-def-badge')].some(badge =>
        /^(?:indiana|indiana lead)$/i.test(clean(badge.textContent))
      ) ? 'Indiana' : ''
    }));
    if (cards.some(c => !/^\d+$/.test(c.id) || !c.name)) throw Error('A lead is missing its name or ID.');
    return {page:Number(match[1]), pages:Number(match[2]), total:Number(countText), cards, signature:cards.map(c=>c.id).join(',')};
  }
  let running = false, stopped = false, rows = [], settings;
  const pause = ms => new Promise(r=>setTimeout(r,ms));
  function check() { if (stopped) throw Error('Stopped. No partial export was produced.'); }
  async function settle(target, oldSignature) {
    const deadline = Date.now()+30000;
    let key='', since=0;
    while (Date.now()<deadline) {
      check();
      const s = snapshot();
      if (s.page===Math.min(target, Math.max(1,s.pages)) && (s.cards.length || s.total===0) && (oldSignature===undefined || s.signature!==oldSignature)) {
        const nextKey = `${s.page}/${s.signature}`;
        if (nextKey!==key) { key=nextKey; since=Date.now(); }
        if (Date.now()-since>=1500) return s;
      } else {key='';since=0;}
      await pause(250);
    }
    throw Error('Page did not finish loading within 30 seconds. Check the page and try again.');
  }
  async function move(direction, s) {
    const arrow = column().querySelector(`.dd-pagination a.${direction}.paging`);
    if (!arrow || arrow.classList.contains('inactive') || arrow.getAttribute('aria-disabled')==='true') throw Error('Pagination arrow is unavailable.');
    arrow.click();
    return settle(s.page+(direction==='next'?1:-1),s.signature);
  }
  $('#tx-stop').onclick = () => {stopped=true; $('#tx-status').textContent='Stopping…';};
  $('#tx-close').onclick = () => showPanel(false);
  $('#tx-start').onclick = async () => {
    if (running) return;
    if (!$('#tx-confirm').checked) {$('#tx-status').textContent='Select the required filters and check the confirmation box.';return;}
    if (!$('#tx-date').value) {$('#tx-status').textContent='Choose the sheet date.';return;}
    const [y,m,d] = $('#tx-date').value.split('-');
    settings={date:`${m}/${d}/${y}`,staff:clean($('#tx-staff').value),account:clean($('#tx-account').value)};
    const existing = new Set($('#tx-existing').value.split(/\s+/).map(x=>x.replace(/^'+/, '')).filter(x=>/^\d+$/.test(x)));
    running=true;stopped=false;rows=[];
    $('#tx-start').disabled=true;$('#tx-stop').disabled=false;$('#tx-close').disabled=false;
    $('#tx-copy').disabled=true;$('#tx-csv').disabled=true;$('#tx-output').style.display='none';
    try {
      let s = await settle(snapshot().page);
      while (s.page>1) {$('#tx-status').textContent=`Returning to page 1 (${s.page}/${s.pages})…`;s=await move('prev',s);}
      const found=new Map();
      // Follow the latest page count; retain each Lead ID only once.
      while (true) {
        check();
        for (const lead of s.cards) found.set(lead.id,lead);
        $('#tx-status').textContent=`Collected page ${s.page}/${s.pages}: ${found.size} unique leads (current stage count: ${s.total})…`;
        if (s.page>=s.pages) break;
        s=await move('next',s);
      }
      rows=[...found.values()].filter(lead=>!existing.has(lead.id)).map(lead=>[
        settings.date,settings.staff,'',lead.name,'','','','','','','',settings.account,lead.id,lead.indiana
      ].map(safe));
      $('#tx-status').textContent=`Finished scanning: ${found.size} unique leads collected; ${found.size-rows.length} existing IDs skipped; ${rows.length} rows ready.`;
      $('#tx-copy').disabled=!rows.length;$('#tx-csv').disabled=!rows.length;
    } catch(e) { rows=[];$('#tx-status').textContent=`Export stopped: ${e.message}`; }
    finally {running=false;$('#tx-start').disabled=false;$('#tx-stop').disabled=true;$('#tx-close').disabled=false;}
  };
  $('#tx-copy').onclick = async () => {
    const tsv=rows.map(row=>row.join('\t')).join('\n');
    try {await navigator.clipboard.writeText(tsv);$('#tx-status').textContent=`Copied ${rows.length} rows. Paste into column A of an empty row.`;}
    catch (_) {const out=$('#tx-output');out.value=tsv;out.style.display='block';out.focus();out.select();$('#tx-status').textContent='Press Ctrl+C to copy the selected output, then paste into column A of an empty row.';}
  };
  $('#tx-csv').onclick = () => {
    const headers=['Date','Staff','Gender','Lead Name','Start/End','Time','Status','Quote Type','Note','Ineligible Note','Note 2','Account name','Lead ID','Indiana'];
    const csv=[headers,...rows].map(row=>row.map(v=>'"'+v.replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='Tritox-New-Leads-'+$('#tx-date').value+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  };
})();
