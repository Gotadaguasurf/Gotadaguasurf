# -*- coding: utf-8 -*-
import re, unicodedata
def norm(s):
    s=unicodedata.normalize('NFD',s or ''); s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    s=re.sub(r'[^a-z0-9 ]',' ',s.lower())
    s=re.sub(r'\b(lda|unipessoal|sa|s a|ltd|gmbh|inc|the|de|da|do|dos|das)\b',' ',s)
    return ' '.join(s.split())
# Nomes diferentes para a mesma entidade. Chave = familia.
FAMILIAS = {
    'gustav': ['gustav sigmundstad', 'sigmundstad'],   # videografo HQ — Salary / general
 'tormenta':      ['tormenta', 'tormenta barreiros', 'easy transfer', 'easytransfer'],
 'manjar':        ['manjar alentejano', 'cathering'],
 'raimundo':      ['raimundo cenas', 'event solutions'],
 'estado':        ['estado at duc', 'autoridade tributaria', 'financas', 'trf cobr duc', 'pag estado', 'imp'],
 'goldenergy':    ['gold energy', 'goldenergy'],
 'segsocial':     ['seguranca social', 'transferencia pag t s u', 'pag t s u'],
 'nata':          ['nata haupt portela', 'nata portela'],
 'heitor':        ['heitor correa souza', 'heitor souza'],
 'joaquim':       ['joaquim manuel resina almeida', 'joaquim resina almeida', 'joaquim almeida'],
 'constancia':    ['constancia pedro carvalho', 'constancia carvalho', 'constancia'],
 'veronica':      ['veronica mariza joao', 'veronica joao', 'veronica'],
 'juares':        ['juares junior', 'juares juvencio silva junior', 'juares silva', 'juares'],
 'lavandaria':    ['lavandaria alexandre', 'lavandaria alexandra', 'lavandaria alexandr'],
 'safari':        ['safari na horta', 'safari na horta animacao turistica', 'safaribus', 'safari'],
 'exuber':        ['exubercaravela'],
 'sparrenberger': ['luis sparrenberger', 'luis felipe sparrenberger', 'carolina sparrenberger', 'carolina massa campos sparrenberger'],
 'vasco':         ['vasco fernandes', 'vasco bruno r alves fernandes'],
 'rci':           ['rci portugal leasing', 'rci connect', 'mobilize'],
 'praiasol':      ['urbanizadora praia sol', 'urb praia sol trafaria'],
 'catarinacart':  ['cart catarina silva', 'cart catarina siva'],
 'shenal':        ['shenal almeida', 'shenal'],
 'blueish':       ['blueish green', 'blueish greenq'],
 'decathlon':     ['decathlon', 'decathlon almada'],
 'souk':          ['souk to surf', 'rxy3q8h referencia desconhecida'],
 'novorumo':      ['novo rumo', 'novo rumo supermercado', 'martinho filhas', 'martinho filhos', 'superm novo rumo', 'novo rumo supermerca'],
 'smas':          ['smas almada', 'smas pragal', 'smas de almada', 'smas'],
 'edp':           ['edp', 'edp comercial', 'edp comercial co', 'gold energy', 'goldenergy'],
 'meo':           ['meo', 'meo sa'],
}
_rev = {}
for fam, nomes in FAMILIAS.items():
    for n in nomes: _rev[norm(n)] = fam
def familia(nome):
    n = norm(nome)
    if n in _rev: return _rev[n]
    for k, fam in _rev.items():
        if k and (n.startswith(k) or k.startswith(n[:14]) and len(n)>=6): return fam
    return n
def payee(desc):
    d=re.sub(r'-[A-Z0-9]{4,}\s*$','',(desc or '').strip())
    d=re.sub(r'^(TRF\.?\s*(IMED\.?|CRED)?\s*(INTRABANC|SEPA\+)?\s*P/|TRF CRED SEPA\+ P/|DÉBITO DIRETO-|DEBITO DIRETO-|COMPRA( ESTRANG)?\s*\*?\d*|LOTE TRF CRED SEPA\+ -)','',d,flags=re.I)
    return d.strip()
