import { createClient } from 'npm:@supabase/supabase-js@2'

type MonthlyProfile = {
  id: string
  profile_type: 'salary' | 'fixed_cost'
  name: string
  category: string
  business_area: string
  season_amount: number | null
  off_season_amount: number | null
  fixed_amount: number | null
  payment_method: string
  description: string | null
}

const corsHeaders = {
  'Content-Type': 'application/json',
}

function monthKey(date: string) {
  return date.slice(0, 7)
}

function monthEndDate(date: string) {
  const [year, month] = monthKey(date).split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

async function fetchEurLkrRate(date: string) {
  const url = `https://api.frankfurter.dev/v2/rate/EUR/LKR?date=${date}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not fetch FX rate for ${date}`)
  }
  const payload = await response.json()
  const rate = Number(payload?.rate || 0)
  if (!(rate > 0)) {
    throw new Error(`FX rate missing for ${date}`)
  }
  return rate
}

function profileAmount(profile: MonthlyProfile, salaryMode: 'season' | 'off') {
  if (profile.profile_type === 'fixed_cost') return Number(profile.fixed_amount || 0)
  if (profile.fixed_amount && profile.fixed_amount > 0) return Number(profile.fixed_amount)
  return salaryMode === 'off'
    ? Number(profile.off_season_amount || 0)
    : Number(profile.season_amount || 0)
}

Deno.serve(async (req) => {
  try {
    const cronSecret = Deno.env.get('MONTH_END_SECRET') || ''
    const providedSecret = req.headers.get('x-month-end-secret') || ''

    if (!cronSecret || providedSecret !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const body = await req.json().catch(() => ({}))
    const runDate = String(body?.runDate || new Date().toISOString().slice(0, 10))
    const salaryMode = body?.salaryMode === 'off' ? 'off' : 'season'
    const locationSlug = String(body?.locationSlug || 'sri-lanka')
    const force = Boolean(body?.force)
    const dueDate = monthEndDate(runDate)

    if (!force && runDate !== dueDate) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'not-last-day',
        runDate,
        dueDate,
      }), { status: 200, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: location, error: locationError } = await supabase
      .from('locations')
      .select('id, slug, name')
      .eq('slug', locationSlug)
      .maybeSingle()

    if (locationError) throw locationError
    if (!location?.id) throw new Error(`Location not found: ${locationSlug}`)

    const fxRate = await fetchEurLkrRate(dueDate)

    const { error: fxUpsertError } = await supabase
      .from('daily_fx_rates')
      .upsert({
        rate_date: dueDate,
        base_currency: 'EUR',
        quote_currency: 'LKR',
        rate: fxRate,
        source: 'frankfurter'
      }, { onConflict: 'rate_date,base_currency,quote_currency' })

    if (fxUpsertError) throw fxUpsertError

    const { data: profiles, error: profilesError } = await supabase
      .from('monthly_cost_profiles')
      .select('id, profile_type, name, category, business_area, season_amount, off_season_amount, fixed_amount, payment_method, description')
      .eq('location_id', location.id)
      .eq('active', true)
      .eq('auto_apply', true)
      .order('sort_order', { ascending: true })

    if (profilesError) throw profilesError

    const recurringMonth = monthKey(dueDate)
    const inserted: string[] = []
    const skipped: string[] = []

    for (const profile of (profiles || []) as MonthlyProfile[]) {
      const amountLocal = profileAmount(profile, salaryMode)
      if (!(amountLocal > 0)) {
        skipped.push(profile.name)
        continue
      }

      const payload = {
        location_id: location.id,
        week_id: null,
        type: 'expense',
        category: profile.category,
        business_area: profile.business_area,
        linked_item: null,
        description: profile.description || profile.name,
        payment_method: profile.payment_method || 'Bank Transfer',
        qty: 1,
        amount_local: amountLocal,
        amount_eur: Number((amountLocal / fxRate).toFixed(2)),
        currency: 'LKR',
        fx_rate: fxRate,
        entry_date: dueDate,
        recurring_source_id: profile.id,
        recurring_month: recurringMonth,
        source_kind: 'month_end_automation'
      }

      const { error: insertError } = await supabase
        .from('ledger_entries')
        .insert(payload)

      if (insertError) {
        const message = String(insertError.message || '').toLowerCase()
        const duplicate = message.includes('duplicate') || message.includes('unique')
        if (duplicate) {
          skipped.push(profile.name)
          continue
        }
        throw insertError
      }

      inserted.push(profile.name)
    }

    return new Response(JSON.stringify({
      ok: true,
      location: location.slug,
      dueDate,
      salaryMode,
      fxRate,
      insertedCount: inserted.length,
      skippedCount: skipped.length,
      inserted,
      skipped
    }), { status: 200, headers: corsHeaders })
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), { status: 500, headers: corsHeaders })
  }
})
