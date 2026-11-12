import json, base64, subprocess, sys
sys.path.insert(0,'/tmp/w/src'); from fichas import F
W='/tmp/w/'
subprocess.run(['npx','esbuild',W+'src/app.js','--bundle','--minify','--format=iife','--target=es2020','--outfile='+W+'app.bundle.js','--log-level=warning'],check=True,cwd='/tmp/w/build',env={**__import__('os').environ,'NODE_PATH':'/tmp/w/build/node_modules'})
st=json.load(open(W+'structures.json'))
rows=[{k:r[k] for k in ('id','pt','la','en','side','cat','color','path')} for r in st['rows']]
meta=dict(rows=rows,groups=st['groups'],fichas=F,geo=json.load(open(W+'geo.json')))
geo=base64.b64encode(open(W+'geo.bin.gz','rb').read()).decode()
fonts=''
FD='/tmp/w/build/node_modules/@fontsource/'
for fam,folder,files in [('Unbounded','unbounded',[('500','unbounded-latin-500-normal.woff2')]),
                         ('Figtree','figtree',[('400','figtree-latin-400-normal.woff2'),('500','figtree-latin-500-normal.woff2'),('600','figtree-latin-600-normal.woff2')]),
                         ('Martian Mono','martian-mono',[('400','martian-mono-latin-400-normal.woff2')])]:
  for w,f in files:
    b=base64.b64encode(open(FD+folder+'/files/'+f,'rb').read()).decode()
    fonts+=f"@font-face{{font-family:'{fam}';font-weight:{w};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,{b}) format('woff2')}}\n"
html=open(W+'src/index.html').read()
app=open(W+'app.bundle.js').read().replace('</script','<\\/script')
html=html.replace('/*FONTS*/',fonts).replace('/*META*/',json.dumps(meta,ensure_ascii=False,separators=(',',':'))).replace('/*GEO*/',geo)
html=html.replace('<script>/*APP*/</script>','<script>'+app+'</script>')
open(W+'out/mielina.html','w').write(html)
print('bytes',len(html.encode()))

# versão para o Artifact: sem doctype/html/head/body (o publicador embrulha a página)
import re
head=re.search(r'<head>(.*?)</head>',html,re.S).group(1)
body=re.search(r'<body>(.*)</body>',html,re.S).group(1)
head=re.sub(r'<meta charset="utf-8">\s*','',head)
head=re.sub(r'<meta name="viewport"[^>]*>\s*','',head)
title=re.search(r'<title>.*?</title>',head).group(0)
head=head.replace(title,'')
open(W+'out/mielina-artifact.html','w').write(title+'\n'+head+'\n'+body)
