# -*- coding: utf-8 -*-
# Gera as páginas de assinatura (signatures/*.html + todas.html).
# Correr a partir da raiz do repo:  python3 signatures/gen.py
import io, os

BASE = 'https://gotadaguasurf.vercel.app'
L = 'color:#233a4d;text-decoration:none;'

# (ficheiro, nome, cargo, email, telefone, foto — ficheiro em assets/sig/people/ ou None)
PEOPLE = [
    ('miguel',     'Miguel Pereira',     'Co-Founder',                'miguel@gotadaguasurf.com',     '+351 916 290 842', 'miguel.jpg'),
    ('accounting', 'Miguel Pereira',     'Co-Founder',                'accounting@gotadaguasurf.com', '+351 916 290 842', 'miguel.jpg'),
    ('info',       'Gonçalo Pereira',    'Co-Founder',                'info@gotadaguasurf.com',       '+351 939 756 959', 'goncalo.jpg'),
    ('kids',       'Gonçalo Pereira',    'Co-Founder',                'kids@gotadaguasurf.com',       '+351 939 756 959', 'goncalo.jpg'),
    ('ricardo',    'Ricardo Carvalho',   'Co-Founder',                'ricardo@gotadaguasurf.com',    '+351 927 488 266', 'ricardo.jpg'),
    ('surfschool', 'Pedro Paiva',        'Co-Founder',                'surfschool@gotadaguasurf.com', '+351 913 227 407', 'pedro.jpg'),
    ('marketing',  'João Girbal',        'Marketing Manager',         'marketing@gotadaguasurf.com',  '+351 915 094 559', 'joao-girbal.jpg'),
    ('groups',     'João Maria André',   'Sales Manager',             'groups@gotadaguasurf.com',     '+351 917 744 363', 'joao-maria.jpg'),
    ('maxime',     'Maxime Dergatcheff', 'Portugal Surf Camp Manager','maxime@gotadaguasurf.com',     None,               'maxime.jpg'),
    ('floriane',   'Floriane Raina',     'Morocco Surf Camp Manager', None,                           '+33 6 33 26 88 24', 'floriane.jpg'),
    ('shenal',     'Shenal de Almeida',  'Sri Lanka Surf Camp Manager', None,                         '+44 7949 557272',  None),
]

def sig_table(name, role, email, phone, photo):
    ph = ''
    if phone:
        ph = (f'<div style="white-space:nowrap;margin-bottom:6px"><a href="tel:{phone.replace(" ", "")}" style="{L}">'
              f'<img src="{BASE}/assets/sig/phone.png" width="18" height="18" style="vertical-align:middle;border:0"> '
              f'<span style="vertical-align:middle">{phone}</span></a></div>')
    em = ''
    if email:
        em = (f'<div style="white-space:nowrap"><a href="mailto:{email}" style="{L}">'
              f'<img src="{BASE}/assets/sig/mail.png" width="18" height="18" style="vertical-align:middle;border:0"> '
              f'<span style="vertical-align:middle">{email}</span></a></div>')
    # Foto redonda antes do nome (border-radius funciona no Gmail; no
    # Outlook clássico fica quadrada — aceitável).
    photo_td = ''
    if photo:
        photo_td = (f'<td style="vertical-align:middle;padding:0 0 0 20px">'
                    f'<img src="{BASE}/assets/sig/people/{photo}" width="72" height="72" alt="{name}" '
                    f'style="display:block;border:0;border-radius:50%"></td>')
    return f'''<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#233a4d;font-size:13px;line-height:1.4"><tbody><tr>
<td style="vertical-align:middle;padding-right:20px;border-right:2px solid #e5e7eb"><a href="https://www.gotadaguasurf.com" style="text-decoration:none"><img src="{BASE}/assets/logos/logo-blue.png" alt="Gota Dagua Surf Camp" width="130" style="display:block;border:0"></a></td>
{photo_td}
<td style="vertical-align:middle;padding:0 20px;border-right:2px solid #e5e7eb">
<div style="font-weight:bold;font-size:17px;margin-bottom:2px;color:#233a4d">{name}</div>
<div style="color:#6b7280;margin-bottom:10px">{role}</div>
{ph}{em}</td>
<td style="vertical-align:middle;padding-left:20px">
<div style="margin-bottom:6px;white-space:nowrap"><a href="https://www.instagram.com/gotadagua_surf" style="{L}"><img src="{BASE}/assets/sig/ig.png" width="20" height="20" style="vertical-align:middle;border:0"> <span style="vertical-align:middle">gotadagua_surf</span></a></div>
<div style="margin-bottom:6px;white-space:nowrap"><a href="https://www.youtube.com/@gotadaguasurf1939" style="{L}"><img src="{BASE}/assets/sig/yt.png" width="20" height="20" style="vertical-align:middle;border:0"> <span style="vertical-align:middle">gotadagua_surf</span></a></div>
<div style="white-space:nowrap"><a href="https://www.gotadaguasurf.com" style="{L}"><img src="{BASE}/assets/sig/web.png" width="20" height="20" style="vertical-align:middle;border:0"> <span style="vertical-align:middle">www.gotadaguasurf.com</span></a></div></td>
</tr></tbody></table>'''

PAGE = '''<!doctype html><html><head><meta charset="utf-8"><title>Assinatura — {name}</title></head>
<body style="background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;padding:34px;color:#233a4d">
<div style="max-width:780px;margin:0 auto">
<h2 style="margin:0 0 6px">Assinatura de email — {name}</h2>
<p style="color:#6b7280;margin:0 0 18px">1&#41; Clica em <b>Copiar assinatura</b> &nbsp;2&#41; Gmail &#8594; &#9881;&#65039; Defini&#231;&#245;es &#8594; "Ver todas as defini&#231;&#245;es" &#8594; sec&#231;&#227;o <b>Assinatura</b> &#8594; Criar nova &#8594; cola (Cmd/Ctrl+V) &#8594; escolhe-a em "para novos emails" e "ao responder" &#8594; Guardar altera&#231;&#245;es.</p>
<button onclick="copySig()" style="background:#233a4d;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:18px">Copiar assinatura</button>
<span id="ok" style="display:none;color:#16a34a;font-weight:700;margin-left:10px">Copiada &#10003;</span>
<div id="sig" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:24px">{table}</div>
</div>
<script>
function copySig(){{
  const el=document.getElementById('sig');
  const r=document.createRange(); r.selectNodeContents(el);
  const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand('copy'); s.removeAllRanges();
  document.getElementById('ok').style.display='inline';
}}
</script></body></html>'''

def main():
    os.makedirs('signatures', exist_ok=True)
    blocks, links = '', []
    for i, (key, name, role, email, phone, photo) in enumerate(PEOPLE):
        table = sig_table(name, role, email, phone, photo)
        io.open(f'signatures/{key}.html', 'w', encoding='utf-8').write(
            PAGE.format(name=f'{name} ({email or role})', table=table))
        links.append((name, email or role, f'{BASE}/signatures/{key}.html'))
        blocks += f'''<div style="margin-bottom:34px">
<h3 style="margin:0 0 4px">{name} — {email or role}</h3>
<button onclick="copySig('sig{i}',this)" style="background:#233a4d;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;margin:6px 0 10px">Copiar</button>
<span style="display:none;color:#16a34a;font-weight:700;margin-left:8px">Copiada &#10003;</span>
<div id="sig{i}" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:22px">{table}</div>
</div>'''
    todas = f'''<!doctype html><html><head><meta charset="utf-8"><title>Assinaturas Gota Dagua</title></head>
<body style="background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;padding:34px;color:#233a4d">
<div style="max-width:820px;margin:0 auto">
<h2 style="margin:0 0 6px">Assinaturas de email — Gota Dagua</h2>
<p style="color:#6b7280;margin:0 0 24px"><b>Como instalar:</b> 1&#41; Clica em <b>Copiar</b> na assinatura certa &nbsp;2&#41; Nessa conta: Gmail &#8594; &#9881;&#65039; &#8594; "Ver todas as defini&#231;&#245;es" &#8594; sec&#231;&#227;o <b>Assinatura</b> &#8594; <b>Criar nova</b> &#8594; cola (Cmd+V) &#8594; escolhe-a em "PARA NOVOS EMAILS" e "AO RESPONDER" &#8594; <b>Guardar altera&#231;&#245;es</b>. Apaga a antiga.</p>
{blocks}
</div>
<script>
function copySig(id,btn){{
  const el=document.getElementById(id);
  const r=document.createRange(); r.selectNodeContents(el);
  const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand('copy'); s.removeAllRanges();
  btn.nextElementSibling.style.display='inline';
}}
</script></body></html>'''
    io.open('signatures/todas.html', 'w', encoding='utf-8').write(todas)
    idx = '<!doctype html><meta charset="utf-8"><title>Assinaturas</title><body style="font-family:Arial;padding:40px;color:#233a4d"><h2>Assinaturas de email — Gota Dagua</h2><p><a href="' + BASE + '/signatures/todas.html"><b>Todas numa página</b></a></p><ul style="line-height:2.2;font-size:15px">'
    for name, sub, url in links:
        idx += f'<li><a href="{url}">{name} — {sub}</a></li>'
    idx += '</ul>'
    io.open('signatures/index.html', 'w', encoding='utf-8').write(idx)
    print('generated', len(PEOPLE), 'signatures')

if __name__ == '__main__':
    main()
