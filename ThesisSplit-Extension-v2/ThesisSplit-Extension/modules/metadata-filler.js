(() => {
 const ns=globalThis.ThesisSplitSipora;
 ns.fillMetadata=(doc,profile,values)=>{
  if(!profile?.verified||!doc.querySelector(profile.fingerprint))throw new Error('unsupported_page');
  // Resolve all fields/options before changing any. The profile comes only from reviewed extension source.
  const fields=Object.entries(profile.metadata||{}).map(([key,selector])=>{
   if(typeof values[key]!=='string'&&typeof values[key]!=='number')throw new Error('metadata_incomplete');
   const element=ns.unique(doc,selector);if(element.disabled||element.type==='password'||element.type==='file')throw new Error('selector_not_found');
   if(element.tagName==='SELECT'){
    const options=Array.from(element.options).filter(o=>o.textContent.trim()===String(values[key]));
    if(options.length!==1)throw new Error('selector_not_found');return {element,value:options[0].value};
   }
   if(!['INPUT','TEXTAREA'].includes(element.tagName))throw new Error('selector_not_found');
   return {element,value:String(values[key])};
  });
  for(const {element,value} of fields){const prototype=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));}
  return {state:'metadata_review',filled:fields.length};
 };
})();
