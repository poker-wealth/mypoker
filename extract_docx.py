import zipfile, re, sys, glob, os, html
def extract(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf-8', 'ignore')
    xml = xml.replace('</w:p>', '\n').replace('<w:tab/>', '\t')
    xml = re.sub(r'<w:br[^>]*/>', '\n', xml)
    text = re.sub(r'<[^>]+>', '', xml)
    text = html.unescape(text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text
for f in sorted(glob.glob('*.docx')):
    base = os.path.splitext(os.path.basename(f))[0].replace(' ','_').replace('(','').replace(')','')
    out = os.path.join('docs_extracted', base + '.txt')
    t = extract(f)
    with open(out,'w',encoding='utf-8') as o:
        o.write(t)
    print(f"{f} -> {out} ({len(t)} chars)")
