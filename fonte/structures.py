# Gera a tabela de estruturas do sistema nervoso: categoria, cor, nomes, hierarquia.
import json, sys, re
sys.path.insert(0, '/tmp/w/src')
from pt import PT
REL='/tmp/w/dl/svi/package/releases/1.2.0/'
m=json.load(open(REL+'manifest.json'))
en=json.load(open(REL+'names/en.json'))['entries']; la=json.load(open(REL+'names/la.json'))['entries']
S={s['id']:dict(s) for s in m['structures']}
# correções de hierarquia (erros da origem)
fix={'nervous.superior_subscapular_nerve_r':'nervous.branches_of_posterior_cord_of_brachial_plexus',
     'nervous.accessory_nerve_xi_l':'nervous.cranial_nerves','nervous.accessory_nerve_xi_r':'nervous.cranial_nerves'}
for k,v in fix.items(): S[k]['parent']=v
def anc(i):
  out=[]; p=S[i]['parent']
  while p: out.append(p); p=S[p]['parent']
  return out
def strip(i): return i.replace('nervous.','')
CRANIAL_COLORS={'olfactory':'#B7E3A0','optic':'#7FD3F5','oculomotor':'#8EA8FF','trochlear':'#B39BFF','trigeminal':'#FFB86B','abducens':'#D49BFF',
 'facial':'#FF9AA8','vestibulocochlear':'#6FE3C8','cochlear':'#6FE3C8','vestibular':'#6FE3C8','glossopharyngeal':'#C9E36F','vagus':'#FFD36B','accessory':'#F0A0E0','hypoglossal':'#9FF0A0',
 'chorda':'#FF9AA8','maxillary':'#FFB86B','mandibular':'#FFB86B','ophthalmic':'#FFB86B','lingual':'#FFB86B','buccal':'#FFB86B','alveolar':'#FFB86B','mental':'#FFB86B','mylohyoid':'#FFB86B'}
LOBE={'frontal_lobe':'#93AEDD','parietal_lobe':'#8CC5B5','occipital_lobe':'#B3A3DC','temporal_lobe':'#E2B98F','insula':'#E3A0B2','limbic_lobe':'#DCC883','interlobar_sulci':'#8E9AAB'}
ASC=['spinothalamic','spinocerebellar','gracile','cuneate','spinotectal','posterolateral']
DESC=['corticospinal','rubrospinal','reticulospinal','vestibulospinal','tectospinal']
def classify(i):
  a=[strip(x) for x in anc(i)]; me=strip(i)
  if 'sense_organs' in a: return 'sentidos','#C9D3DF'
  if 'meninges' in a: return 'meninges','#8FB6D9'
  if 'ventricle' in me or 'aqueduct' in me or 'central_canal' in me or 'choroid' in me: return 'ventriculos','#45D4E0'
  if 'cranial_nerves' in a or me.startswith('accessory_nerve') or 'optic_chiasm' in me or 'optic_tract' in me:
    for k,c in CRANIAL_COLORS.items():
      if k in me: return 'cranianos',c
    for x in a:
      for k,c in CRANIAL_COLORS.items():
        if k in x: return 'cranianos',c
    return 'cranianos','#FFD36B'
  if 'autonomic_division_of_peripheral_nervous_system' in a: return 'autonomo','#5FD6A0'
  if 'peripheral_nervous_system' in a: return 'espinais','#F2C462'
  if 'spinal_cord' in a:
    if any(k in me for k in ASC): return 'medula','#5B9DFF'
    if any(k in me for k in DESC): return 'medula','#FF7A6B'
    if 'grey_matter' in ' '.join(a) or 'horn' in me or 'nucleus' in me or 'intermedi' in me or 'reticular' in me: return 'medula','#C9B9A6'
    return 'medula','#E8E2D4'
  if 'cerebellum' in a:
    vermis=('vermis' in me or me in ('culmen','declive','central_lobule','lingula_of_cerebellum'))
    if 'peduncle' in me: return 'cerebelo','#E2C9B8'
    return 'cerebelo','#D98E86' if vermis else '#E7A79C'
  if 'brainstem' in a:
    if 'nucleus' in me or 'nuclei' in me:
      for k,c in CRANIAL_COLORS.items():
        if k in me: return 'tronco',c
      if 'solitary' in me or 'ambiguus' in me or 'vagus' in me or 'salivatory' in me: return 'tronco','#FFD36B'
      if 'red_nucleus' in me: return 'tronco','#FF6B6B'
      return 'tronco','#F0C8A0'
    if 'olive' in me: return 'tronco','#E8B4C8'
    if 'pyramid' in me: return 'tronco','#FF9A8A'
    if 'colliculus' in me: return 'tronco','#F3D9A8'
    return 'tronco','#D9B8B0'
  if 'white_matter_of_telencephalon_l' in a or 'white_matter_of_telencephalon_r' in a or 'white_matter_of_diencephalon' in a or me.startswith('white_matter') or me in ('septum_pellucidum',):
    if 'corpus_callosum' in me: return 'branca','#F4EEDF'
    if 'fornix' in me: return 'branca','#F7E3A3'
    if 'commissure' in me: return 'branca','#F2D8B0'
    return 'branca','#ECE6D8'
  if 'diencephalon' in a or 'basal_forebrain' in a or 'corpus_striatum' in a or 'hippocampus' in me:
    col={'thalamus':'#F2A65A','hypothalamus':'#F27979','geniculate':'#F2C27A','habenula':'#E89A6A','mamillary':'#F59E9E','amygdal':'#F2667A','septal':'#C9A0F0',
         'caudate':'#6FB3F2','putamen':'#5A93E0','globus_pallidus':'#9BC8F7','lentiform':'#5A93E0','hippocampus':'#F5D45E'}
    for k,c in col.items():
      if k in me: return 'nucleos',c
    return 'nucleos','#F0B080'
  for x in a:
    if x in LOBE:
      c=LOBE[x]
      if ('sulc' in me and 'gyr' not in me) or me.startswith('lat_fis'): c=shade(c,0.70)
      return 'cortex',c
  return 'outros','#CCCCCC'
def shade(h,f):
  r,g,b=int(h[1:3],16),int(h[3:5],16),int(h[5:7],16)
  return '#%02X%02X%02X'%(int(r*f),int(g*f),int(b*f))
def lobe_of(i):
  for x in anc(i):
    if strip(x) in LOBE: return strip(x)
  return None
rows=[]
for s in m['structures']:
  if s['system']!='nervous' or not s.get('meshes'): continue
  i=s['id']; cat,col=classify(i)
  e=en[i]['name']; l=la.get(i,{}).get('name')
  rows.append(dict(id=strip(i),en=e,la=l,pt=PT[e],side=s.get('side'),cat=cat,color=col,meshes=s['meshes'],
    path=[strip(x) for x in reversed(anc(i))][1:], lobe=lobe_of(i)))
groups={}
for s in m['structures']:
  if s['system']=='nervous' and s['kind']!='structure':
    e=en[s['id']]['name']; groups[strip(s['id'])]=dict(pt=PT[e],en=e,la=la.get(s['id'],{}).get('name'),parent=strip(S[s['id']]['parent'] or '') or None)
# estruturas com malha que também são "pais" viram grupo nominal
json.dump(dict(rows=rows,groups=groups),open('/tmp/w/structures.json','w'),ensure_ascii=False)
from collections import Counter
print(Counter(r['cat'] for r in rows)); print(len(rows))
print([r['id'] for r in rows if r['cat']=='outros'])
