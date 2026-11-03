/* Shared pure logic; no network or browser dependencies. */
const Core = (() => {
  function segment(value) {
    return String(value || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.{2,}/g,'_').replace(/[. ]+$/g,'').replace(/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i,'_$1$2').slice(0,100) || 'Untitled';
  }
  function portalUrl(value, host) {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['lms.bahria.edu.pk','cms.bahria.edu.pk'].includes(u.hostname) || (host && u.hostname !== host) || u.username || u.password || u.port) throw Error('Use an HTTPS Bahria LMS or CMS URL.');
    return u.href;
  }
  return {segment,portalUrl};
})();
if (typeof module !== 'undefined') module.exports=Core;
