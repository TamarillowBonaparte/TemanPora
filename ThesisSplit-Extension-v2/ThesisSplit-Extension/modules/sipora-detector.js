(() => {
 const ns=globalThis.ThesisSplitSipora=globalThis.ThesisSplitSipora||{};
 ns.detect=(doc,url)=>{
  if(new URL(url).origin!==globalThis.ThesisSplitConfig.siporaOrigin)return {state:'wrong_tab',message:'Domain bukan SIPORA yang diizinkan.'};
  if(doc.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],input[name="g-recaptcha-response"]'))return {state:'captcha_required',message:'Selesaikan CAPTCHA sendiri di SIPORA.'};
  if(doc.querySelector('input[autocomplete="one-time-code"]'))return {state:'otp_required',message:'Selesaikan OTP sendiri di SIPORA.'};
  if(doc.querySelector('input[type="password"]'))return {state:'login_required',message:'Login langsung di SIPORA. Extension tidak membaca kolom login.'};
  const logout=Array.from(doc.querySelectorAll('a,button,input[type="submit"]')).some(el=>/^(LOGOUT|LOG OUT|KELUAR)$/i.test((el.textContent||el.value||'').trim()));
  const profile=globalThis.ThesisSplitConfig.verifiedProfiles.find(p=>p.origin===new URL(url).origin&&p.verified===true&&p.fingerprint&&doc.querySelector(p.fingerprint));
  return profile?{state:'deposit_page_detected',profile:profile.id,message:'Profil halaman terverifikasi ditemukan. Periksa setiap langkah sebelum tindakan.'}:
   {state:logout?'unsupported_page':'user_action_required',message:logout?'Sesi login terindikasi, tetapi form belum terverifikasi. Gunakan panduan manual.':'Status login belum dapat dipastikan. Login sendiri dan gunakan panduan manual bila form belum dikenali.'};
 };
 ns.unique=(doc,selector)=>{const all=doc.querySelectorAll(selector);if(all.length!==1)throw new Error('selector_not_found');return all[0];};
})();
