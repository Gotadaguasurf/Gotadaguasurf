// Partner aliases — several partner records that are ONE company (18 Nov 2026).
// Bookinglayer and the invoices spell some partners in more than one way; the
// records stay as they are (nothing is merged or renamed) and the lists that
// answer «who owes us» group them under one display name.
//
// The ONE place to edit: add the display name and every spelling below, then
// copy the same pairs into partner_alias() in supabase/partners-open-invoices.sql
// (tests/partners-owes.spec.js fails when the two lists differ).
(function (root) {
  const GROUPS = {
    'Surf Camp IT': ['SURFCAMP IT', 'Surfcamp Italy', 'Surfhouse.it'],
    'Surfwise':     ['SURFWISE', 'Surfwise Travel'],
  };
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  const MAP = {};
  Object.keys(GROUPS).forEach(d => { MAP[norm(d)] = d; GROUPS[d].forEach(n => { MAP[norm(n)] = d; }); });

  const PartnerAlias = {
    GROUPS,
    // 'Surfcamp Italy' → 'Surf Camp IT'; a name with no alias comes back trimmed
    display(name) { return MAP[norm(name)] || String(name == null ? '' : name).trim(); },
    // grouping key: the same for every spelling of one company
    key(name) { return norm(PartnerAlias.display(name)); },
    isAlias(name) { return Object.prototype.hasOwnProperty.call(MAP, norm(name)); },
    same(a, b) { return PartnerAlias.key(a) === PartnerAlias.key(b); },
  };
  root.PartnerAlias = PartnerAlias;
  if (typeof module !== 'undefined' && module.exports) module.exports = PartnerAlias;
})(typeof window !== 'undefined' ? window : globalThis);
