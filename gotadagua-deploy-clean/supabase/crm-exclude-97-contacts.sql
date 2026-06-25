-- ════════════════════════════════════════════════════════════════════════════
--  Mark 97 contacts as excluded from outreach (per QA "remove_from_app.csv")
--
--  These are platforms / OTAs / competitors / CrossFit gyms that don't fit
--  the ICP. The QA spec says NOT to delete — just to flag so they drop out
--  of the active outreach flow. We use status='lost' + lost_reason to
--  surface why, without inventing a new status value.
--
--  Rows that had no email in the CSV need manual handling (no match key);
--  they're listed at the bottom — UPDATE by id from the Supabase Table
--  Editor if you want them excluded too.
-- ════════════════════════════════════════════════════════════════════════════

update public.outreach_contacts
   set status = 'lost',
       lost_reason = coalesce(lost_reason, '') || case when lost_reason is null or lost_reason = '' then '' else ' · ' end || 'Excluded from outreach (not ICP)'
 where lower(email) = any (array[
   -- Resellers / partners
   'info@surfawhile.com','travelteam@euroventure.com','mees@surfawhile.com',
   -- CrossFit
   'info@crossfitmunich.com','info@crossfitnordic.se','eivind@ringard.no',
   -- Platforms / OTAs / marketplaces (travel)
   'info@atolltravel.com','aurora@booksurfcamps.com','indrajit@boompop.com',
   'partner@moverii.de','maxime@naboo.app','bookings@nomadsurfers.com',
   'info@outerreefsurftravel.com','info@planetsurfcamps.com','info@puresurfcamps.com',
   'contact@rapturecamps.com','info@stoketravel.com','hello@stokedsurfadventures.com',
   'surfexpressfl@gmail.com','help@surftripsupply.com','info@surfcamp-online.com',
   'info@surfholidays.com','thomas@teamout.com','enquiries@surftravel.com.au',
   'help@thermal.travel','hostsupport@trovatrip.com','office@wavetours.com',
   'info@wetravel.com','surfcamps@wellenreiter.com',
   -- Retreat marketplaces
   'sean@bookretreats.com','info@tripaneer.com','bookings@compareretreats.com',
   'hello@experienceretreats.com','support@nextretreat.com','elisa@outsite.co',
   'support@retreat.guru','info@retreathub.com','marina@retreatsandvenues.com',
   'hello@venueretreat.com',
   -- Retreat / surf-camp competitors (own camp)
   'info@activeescapes.com','bluemind@bananasurfmorocco.com','info@bodhisurfyoga.com',
   'info@chicksonwaves.com','hi@coworksurf.com','info@escapehaven.com',
   'hello@lavidasurf.com','surfing@lasolas.surf','info@morocsurf.com',
   'info@puravidaadventures.com','contact@rebornsurfcamp.com','hello@riseupsurf.com',
   'info@saltysoulsexperience.com','enquiries@soulandsurf.com','info@starsurfcamps.com',
   'amouage@surfmaroc.com','hello@surfwithamigas.com','surf@surfaris.com',
   'hello@surfergoddessretreats.com','info@surfivorcamp.com','cascais@thesalty.co',
   'jen@thetravelyogi.com','info@truenaturetravels.com','hello@wodholidays.com',
   'girlonthewave@gmail.com','info@lapointcamps.com','surf@mellowmove.com',
   'originalsurfmorocco@gmail.com','contact@surfberbere.com'
 ]);

-- Verify how many landed (should be ~67 — the ones from the CSV that had
-- an email. The rest had no email and need manual handling).
select count(*) as excluded_now
  from public.outreach_contacts
 where status = 'lost'
   and lost_reason like '%Excluded from outreach%';

-- ── Companies in remove_from_app.csv WITHOUT email ─────────────────────────
-- These cannot be matched by SQL key. Open each in the CRM Contacts tab
-- and either set status → Lost manually, or paste this list into a
-- search box to find and bulk-select.
--
--   CrossFit AKA Amsterdam, CrossFit Aan T IJ, CrossFit Amsterdam,
--   CrossFit Aveiro, CrossFit Christiania, CrossFit F2, CrossFit Werk,
--   DEIN CrossFit, Fell Training Collective, Frontline Berlin,
--   Mobilis CrossFit, My Fitness Trips, Off Limits CrossFit Rato,
--   WIT Training, XXI CrossFit, Coliving.com, Pure Vacations,
--   Surf-escape, Surf-school-alliance.org, VenueScanner,
--   Basejam, Healthy Holiday Company, Camp Wanderlost,
--   Salty Soul Wellness, Sister Surf & Yoga Retreat,
--   Surf Goddess Retreats, Dreamsea Surf Camp, Skyhook Adventure.
