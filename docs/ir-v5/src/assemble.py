import fitz, pathlib, sys, json
# 사용: python -I -X utf8 assemble.py <v4.pdf> <출력.pdf>   (먼저 build.py)
# 쪽 순서는 build.py가 order.txt에서 읽어 out/order.json에 남긴 것을 쓴다
root = pathlib.Path(__file__).parent
src = fitz.open(sys.argv[1]); new = fitz.open(root/"out"/"new.pdf")
info = json.loads((root/"out"/"order.json").read_text(encoding="utf-8"))
order, patches = info["order"], info["patches"]
n_html = sum(1 for e in order if not e.startswith("v4:"))
assert n_html + len(patches) == new.page_count, (n_html, len(patches), new.page_count)
# 꼬리말 쪽 번호 자리 (1280x720px 기준 x1140~1200, y650~682 → pt 0.75배)
NUM = fitz.Rect(1140*.75, 650*.75, 1200*.75, 682*.75)
out = fitz.open()
hi = 0
for i, e in enumerate(order):
    n = i + 1
    if e.startswith("v4:"):
        k = int(e[3:]) - 1
        out.insert_pdf(src, from_page=k, to_page=k)
        if n in patches:
            pg = out[-1]
            bg = src[k].get_pixmap(clip=fitz.Rect(10, 10, 12, 12)).pixel(0, 0)
            # 구워진 옛 번호(이미지와 OCR 글자)를 배경색으로 지우고 새 번호를 얹는다
            pg.add_redact_annot(NUM, fill=[c/255 for c in bg[:3]])
            pg.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
            pg.draw_rect(NUM, color=None, fill=[c/255 for c in bg[:3]], overlay=True)
            pg.show_pdf_page(NUM, new, n_html + patches.index(n), clip=NUM, overlay=True)
    else:
        pg = out.new_page(width=960, height=540)
        pg.show_pdf_page(pg.rect, new, hi); hi += 1
out.save(sys.argv[2], garbage=4, deflate=True)
chk = fitz.open(sys.argv[2])
print("pages", chk.page_count, "links", {i+1: len(chk[i].get_links()) for i in range(chk.page_count) if chk[i].get_links()})
for i, e in enumerate(order):
    t = chk[i].get_text().strip().split("\n")
    print(i+1, e, t[0][:30], "| footer:", t[-1][:6] if t else "")
