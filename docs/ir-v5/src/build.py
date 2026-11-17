import subprocess, sys, pathlib, pymupdf, re
root=pathlib.Path(__file__).parent
pages=sorted(root.glob("pages/p*.html"))
nums=[int(re.search(r"p(\d+)",p.name).group(1)) for p in pages]
html="<!doctype html><html lang='ko'><head><meta charset='utf-8'><link href='https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=Noto+Serif+KR:wght@500;600;700&display=swap' rel='stylesheet'><link rel='stylesheet' href='deck.css'></head><body>"+"".join(p.read_text(encoding="utf-8") for p in pages)+"</body></html>"
(root/"all.html").write_text(html,encoding="utf-8")
chrome=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
out=root/"out"/"new.pdf"
subprocess.run([chrome,"--headless=new","--disable-gpu","--no-pdf-header-footer","--virtual-time-budget=15000",f"--user-data-dir={root/'chrome-prof'}",f"--print-to-pdf={out}",(root/"all.html").as_uri()],check=True,capture_output=True,timeout=180)
nd=pymupdf.open(out)
print("new pages",len(nd),"expected",len(nums))
assert len(nd)==len(nums)
for i,n in enumerate(nums):
    nd[i].get_pixmap(dpi=100).save(root/"out"/f"n{n:02d}.png")
print(nums)
