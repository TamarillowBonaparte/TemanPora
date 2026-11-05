(() => {
 const ns=globalThis.ThesisSplitSipora;
 ns.confirmDisciplines=(doc,profile,values,confirmed)=>{
  if(!confirmed||!values.length)throw new Error('user_action_required');
  if(!profile?.verified||!profile.disciplineOptions)throw new Error('unsupported_page');
  const options=Array.from(doc.querySelectorAll(profile.disciplineOptions));
  if(values.some(value=>!options.some(option=>option.textContent.trim()===value)))throw new Error('selector_not_found');
  return {state:'discipline_selection',message:'Pilihan tersedia; pengguna memilih dan memeriksa rumpun langsung di SIPORA.'};
 };
})();
