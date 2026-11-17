import fitz, pathlib, re, sys
root = pathlib.Path(__file__).parent
src = fitz.open(sys.argv[1]); new = fitz.open(root/"out"/"new.pdf")
nums = sorted(int(re.search(r"p(\d+)", p.name).group(1)) for p in (root/"pages").glob("p*.html"))
assert len(nums) == new.page_count, (len(nums), new.page_count)
out = fitz.open()
for i in range(src.page_count):
    n = i + 1
    if n in nums:
        pg = out.new_page(width=960, height=540)
        pg.show_pdf_page(pg.rect, new, nums.index(n))
    else:
        out.insert_pdf(src, from_page=i, to_page=i)
out.save(sys.argv[2], garbage=4, deflate=True)
chk = fitz.open(sys.argv[2])
print("pages", chk.page_count, "links p27", len(chk[26].get_links()), "replaced", nums)
for n in nums:
    t = chk[n-1].get_text().strip().split("\n")[0]
    print(n, chk[n-1].rect.width, chk[n-1].rect.height, t[:30])
