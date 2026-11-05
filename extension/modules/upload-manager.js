(() => {
 const ns=globalThis.ThesisSplitSipora;
 ns.verifyUploads=(doc,profile,files)=>{
  if(!profile?.verified||!profile.uploadRows)throw new Error('unsupported_page');
  const rows=Array.from(doc.querySelectorAll(profile.uploadRows));
  const matched=files.filter(file=>rows.some(row=>row.textContent.includes(file.filename)&&[file.content,file.description,file.visible_to].every(value=>row.textContent.includes(value))&&row.textContent.includes(file.license)));
  return {state:matched.length===4?'upload_completed':'upload_failed',completed_files:matched.length,total_files:4};
 };
 // File input selection is deliberately left to the user until actual SIPORA upload controls are verified.
})();
