// ════════════════════════════════════════════════════════════════════════════
//  Who is calling an Edge Function — one copy of the caller checks
//  (audit 18 Nov 2026: SEC-03, SEC-18).
//
//  New checks are STAGED: until the project secret ENFORCE_CALLER_CHECKS is
//  'true' a caller that would be refused is only logged («would refuse …»),
//  so a deploy can never cut off a cron job or a page that still works today.
//  Turn it on after one look at the function logs: every call there should
//  be a team login or the cron's service-role key.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL_  = () => Deno.env.get('SUPABASE_URL') || ''
const ANON  = () => Deno.env.get('SUPABASE_ANON_KEY') || ''
const SVC   = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

export const enforcing = (flag = 'ENFORCE_CALLER_CHECKS') => Deno.env.get(flag) === 'true'

export function bearer(req: Request): string {
  return (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
}

// The «role» claim of a JWT (anon, authenticated, service_role). Not a proof by itself.
export function jwtRole(token: string): string {
  try {
    const p = token.split('.')[1] || ''
    const b = p.replace(/-/g, '+').replace(/_/g, '/')
    return String(JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))).role || '')
  } catch { return '' }
}

// The project's service-role key (what pg_cron sends). Compared with the key the
// function itself holds; a service_role JWT of another format (legacy eyJ… vs
// sb_secret_…) is proven by asking the Auth admin API, which only that key opens.
export async function isServiceKey(token: string): Promise<boolean> {
  if (!token) return false
  if (SVC() && token === SVC()) return true
  if (jwtRole(token) !== 'service_role') return false
  try {
    const r = await fetch(`${URL_()}/auth/v1/admin/users?per_page=1`, { headers: { apikey: token, authorization: `Bearer ${token}` } })
    return r.ok
  } catch { return false }
}

// The signed-in person behind a token, or null (anon key, service key, expired session).
export async function userOf(token: string): Promise<{ id: string; email: string } | null> {
  if (!token) return null
  const c = createClient(URL_(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.getUser(token)
  return error || !data?.user ? null : { id: data.user.id, email: String(data.user.email || '').toLowerCase() }
}

// An active profile with at least one active area, or the platform's super_admin.
// deno-lint-ignore no-explicit-any
export async function isTeamMember(admin: any, userId: string): Promise<boolean> {
  const { data: prof } = await admin.from('platform_profiles').select('platform_role, active').eq('id', userId).maybeSingle()
  if (!prof || prof.active !== true) return false
  if (prof.platform_role === 'super_admin') return true
  const { data: rows } = await admin.from('workspace_memberships').select('id').eq('user_id', userId).eq('active', true).limit(1)
  return (rows?.length ?? 0) > 0
}

// is_hq_member() as the caller sees it (the same rule the HQ tables use).
export async function isHqUser(token: string): Promise<boolean> {
  if (!token) return false
  const c = createClient(URL_(), ANON(), { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
  const { data, error } = await c.rpc('is_hq_member')
  return !error && data === true
}

// Refuse (when enforcing) or log (until then). Returns true when the call must stop.
export function refuseOrLog(fn: string, why: string, flag = 'ENFORCE_CALLER_CHECKS'): boolean {
  if (enforcing(flag)) return true
  console.warn(`${fn}: would refuse (${why}) — allowed until ${flag}=true`)
  return false
}
