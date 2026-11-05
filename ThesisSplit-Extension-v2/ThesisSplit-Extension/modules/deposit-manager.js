(() => {
 const ns=globalThis.ThesisSplitSipora;
 ns.deposit=(doc,profile,confirmation)=>{
  if(!confirmation?.explicit||Date.now()-confirmation.at>30000||Date.now()<confirmation.at)throw new Error('user_action_required');
  if(!profile?.verified||!doc.querySelector(profile.fingerprint)||!profile.depositButton)throw new Error('unsupported_page');
  const button=ns.unique(doc,profile.depositButton);
  if(button.disabled||(button.textContent||button.value||'').trim()!=='Deposit Item Now')throw new Error('selector_not_found');
  button.click();return {state:'status_verification',message:'Klik belum membuktikan deposit berhasil.'};
 };
 ns.verifyDeposit=(doc,profile,expectedTitle)=>{
  if(!profile?.verified||!profile.itemTitle||!profile.itemStatus||!expectedTitle)throw new Error('deposit_status_uncertain');
  const title=ns.unique(doc,profile.itemTitle).textContent.trim();
  if(title!==expectedTitle.trim())throw new Error('deposit_status_uncertain');
  const status=ns.unique(doc,profile.itemStatus).textContent.trim();
  return {state:status==='Under Review'?'completed':status==='Under Workarea'?'user_action_required':'deposit_status_uncertain',message:status==='Under Review'?'Status item terverifikasi: Under Review.':'Status item belum memastikan deposit berhasil.'};
 };
})();
