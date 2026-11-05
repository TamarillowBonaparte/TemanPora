export const SIPORA_ORIGIN = 'https://sipora.polije.ac.id';
export function isAllowedOrigin(url, origins) { try { return origins.includes(new URL(url).origin); } catch { return false; } }
export function safeStatus(state = {}) {
 return {state:state.state || 'extension_ready', jobId:state.jobId, domain:state.domain,
   message:state.message, completed_files:state.completed_files || 0, total_files:4};
}
export function canAct(state) { return !!state && !['paused','stopped','disconnected'].includes(state.state) && Date.now() < Date.parse(state.expires_at || ''); }
export function nextDepositStatus(status, sameItem) {
 if (!sameItem) return 'deposit_status_uncertain';
 if (status === 'Under Review') return 'completed';
 return status === 'Under Workarea' ? 'user_action_required' : 'deposit_status_uncertain';
}
