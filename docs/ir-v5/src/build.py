import subprocess, sys, pathlib, pymupdf, re, os, glob, shutil, json
root=pathlib.Path(__file__).parent
# 쪽 순서는 order.txt 한 곳에서 정한다. pNN = pages/pNN.html, v4:N = v4 PDF 복사 쪽
order=[l.strip() for l in (root/"order.txt").read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]
html_pages=[(i+1,e) for i,e in enumerate(order) if not e.startswith("v4:")]
FT=re.compile(r'(<div class="ft"><span class="b">RE:ADD</span><span>)\d+(</span></div>)')
parts=[]
for num,name in html_pages:
    src=(root/"pages"/f"{name}.html").read_text(encoding="utf-8")
    src,k=FT.subn(rf"\g<1>{num}\g<2>",src)  # 꼬리말 쪽 번호 = 덱 안의 실제 위치
    assert k==1,(name,k)
    parts.append(src)
# v4에서 복사하는 쪽 중 번호가 바뀐 쪽: 꼬리말 숫자만 있는 투명 쪽을 뒤에 붙여 assemble.py가 덮어씌운다
patches=[(i+1,e) for i,e in enumerate(order) if e.startswith("v4:") and int(e[3:])!=i+1]
for num,e in patches:
    parts.append(f'<div class="pg" style="background:transparent"><div class="ft"><span></span><span>{num}</span></div></div>')
html="<!doctype html><html lang='ko'><head><meta charset='utf-8'><link href='https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=Noto+Serif+KR:wght@500;600;700&display=swap' rel='stylesheet'><link rel='stylesheet' href='deck.css'></head><body>"+"".join(parts)+"</body></html>"
(root/"all.html").write_text(html,encoding="utf-8")

def find_chrome():
    # 1) 환경 변수로 지정  2) Windows Chrome  3) Linux Playwright 브라우저  4) PATH
    # Linux 컨테이너에서는 정식 chrome --headless=new가 응답 없이 멈춰서 headless shell을 먼저 쓴다
    env=os.environ.get("READD_CHROME")
    if env: return env
    win=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    if os.path.exists(win): return win
    pw=sorted(glob.glob("/opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell"))+sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome"))
    if pw: return pw[0]
    for n in ("google-chrome","chromium","chromium-browser"):
        p=shutil.which(n)
        if p: return p
    sys.exit("Chrome을 찾지 못했다. READD_CHROME 환경 변수로 경로를 지정한다.")

chrome=find_chrome()
(root/"out").mkdir(exist_ok=True)
out=root/"out"/"new.pdf"
args=[chrome]+([] if "headless-shell" in chrome else ["--headless=new"])+["--disable-gpu","--no-pdf-header-footer","--virtual-time-budget=15000",f"--user-data-dir={root/'chrome-prof'}",f"--print-to-pdf={out}"]
if os.name!="nt": args.insert(1,"--no-sandbox")
r=subprocess.run(args+[(root/"all.html").as_uri()],capture_output=True,timeout=180)
if r.returncode: sys.exit(r.stderr.decode(errors="replace")[-2000:])
nd=pymupdf.open(out)
print("chrome",chrome)
print("new pages",len(nd),"expected",len(html_pages),"+ number patches",len(patches))
assert len(nd)==len(html_pages)+len(patches)
fonts=sorted({f[3] for i in range(len(nd)) for f in nd[i].get_fonts()})
print("fonts",fonts)
# Noto Serif KR은 이름 없는 글꼴로 실려 이름으로 확인할 수 없다. 제목 글꼴은 PNG를 눈으로 확인한다
if not any("IBMPlexSansKR" in f for f in fonts):
    print("경고: Google Fonts(IBM Plex Sans KR)가 실리지 않았다. 대체 글꼴로 조판됨, 미리보기용으로만 쓴다.")
for i,(num,name) in enumerate(html_pages):
    nd[i].get_pixmap(dpi=100).save(root/"out"/f"n{num:02d}.png")
(root/"out"/"order.json").write_text(json.dumps({"order":order,"patches":[n for n,_ in patches]}),encoding="utf-8")
print([f"{num}:{name}" for num,name in html_pages])
