import sys, json, re
p, dj = sys.argv[1], sys.argv[2]
d = json.load(open(dj))
pl, cum = d['pl'], d['cum']
RED, NAVY, GRN = '#a8432f', '#1c2233', '#2f6b4f'

def chart(vals, months, vmin, vmax, cross, mark_lab, mark_sub, end_lab, low_lab, aria):
    W, H = 545, 290
    L, R, T, B = 8, W - 8, 46, H - 28
    n = len(vals)
    step = (R - L) / n; bw = step * 0.62
    y = lambda v: T + (vmax - v) / (vmax - vmin) * (B - T)
    cx = lambda i: L + step * i + step / 2
    o = ['<svg width="%d" height="%d" viewBox="0 0 %d %d" style="font-family:Noto Sans KR,sans-serif" role="img" aria-label="%s">' % (W, H, W, H, aria)]
    # shaded areas: before / after cross
    ci = months.index(cross)
    xc = L + step * ci
    o.append('<rect x="%d" y="%d" width="%.0f" height="%d" fill="#a8432f" opacity="0.06"></rect>' % (L, T - 6, xc - L, B - T + 6))
    o.append('<rect x="%.0f" y="%d" width="%.0f" height="%d" fill="#1c2233" opacity="0.05"></rect>' % (xc, T - 6, R - xc, B - T + 6))
    o.append('<text x="%.0f" y="%d" text-anchor="middle" font-size="12.5" font-weight="700" fill="%s">적자</text>' % ((L + xc) / 2, B + 22 - (B - T) + 0, RED))
    o.append('<text x="%.0f" y="%d" text-anchor="middle" font-size="12.5" font-weight="700" fill="%s">흑자</text>' % ((xc + R) / 2, B + 22 - (B - T) + 0, NAVY))
    for i, v in enumerate(vals):
        h = abs(v) / (vmax - vmin) * (B - T)
        top = y(0) if v < 0 else y(0) - h
        o.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s"></rect>' % (cx(i) - bw / 2, top, bw, max(h, 1.5), RED if v < 0 else NAVY))
    o.append('<line x1="%d" x2="%d" y1="%.1f" y2="%.1f" stroke="#1c2233" stroke-width="1.5"></line>' % (L, R, y(0), y(0)))
    # crossing marker on zero line
    o.append('<line x1="%.1f" x2="%.1f" y1="%d" y2="%d" stroke="%s" stroke-width="2"></line>' % (xc, xc, T - 6, B, GRN))
    o.append('<circle cx="%.1f" cy="%.1f" r="7" fill="#fcfaf5" stroke="%s" stroke-width="3"></circle>' % (xc, y(0), GRN))
    anchor = 'end' if xc > W * 0.6 else 'start'
    tx = xc - 8 if anchor == 'end' else xc + 8
    ly = y(0) - 38 if anchor == 'end' else y(0) + 28
    o.append('<text x="%.1f" y="%.1f" text-anchor="%s" font-size="15" font-weight="700" fill="%s">%s</text>' % (tx, ly, anchor, GRN, mark_lab))
    o.append('<text x="%.1f" y="%.1f" text-anchor="%s" font-size="13" fill="#1c2233">%s</text>' % (tx, ly + 18, anchor, mark_sub))
    # end / low labels
    il = min(range(n), key=lambda i: vals[i])
    o.append('<text x="%.1f" y="%.1f" text-anchor="middle" font-size="13" font-weight="700" fill="%s">%s</text>' % (cx(il), y(vals[il]) + 16, RED, low_lab))
    o.append('<text x="%.1f" y="%.1f" text-anchor="end" font-size="13" font-weight="700" fill="%s">%s</text>' % (cx(n - 1) + bw / 2, y(vals[-1]) - 6, NAVY, end_lab))
    for i, m in enumerate(months):
        if m in ((0, 6, 12, 18, 24) if months[0] == 0 else (1, 6, 12, 18, 24)):
            o.append('<text x="%.1f" y="%d" text-anchor="middle" font-size="12.5" fill="#4a5162">%s</text>' % (cx(i), H - 8, '준비' if m == 0 else '%d개월' % m))
    o.append('</svg>')
    return '\n'.join(o)

m1 = list(range(1, 25))
c1 = chart(pl[1:], m1, -360, 450, 9, 'BEP 시점', '9개월 차 (2027년 8월)', '+413만', '−262만',
           '월 손익: 1~8개월 차 적자, 9개월 차부터 흑자')
m2 = list(range(0, 25))
c2 = chart(cum, m2, -2750, 2000, 20, '투자금 회수 시점', '20개월 차 (2028년 7월)', '+1,861만', '−2,257만',
           '누적 손익: 8개월 차 최저 -2,257만 원, 20개월 차부터 플러스')
sec = '''<!-- 15-2. FINANCIALS 재무 전망 그래프 -->
<section class="pg flow2">
  <div class="eb">FINANCIALS · 재무 전망</div>
  <div class="t">출시 9개월 차에 BEP(손익분기점)를 넘고, 20개월 차에 투자금을 회수합니다<br>필요 자금: 약 2,260만 원</div>
  <div class="body" style="top:200px">
    <div class="two">
      <div><div class="lb">월 손익 (만 원) · 그달 들어온 돈 − 나간 돈</div>%s</div>
      <div><div class="lb">누적 손익 (만 원) · 출시 전 2개월 포함</div>%s</div>
    </div>
    <div class="stats">
      <div><span>필요 자금</span><b>약 2,257만 원</b><i>출시 전 573만 + 흑자 전 적자 1,684만</i></div>
      <div><span>BEP 유료 구독자</span><b>2,888명</b><i>9개월 차 유료 3,022명으로 넘김</i></div>
      <div><span>24개월 차 누적 손익</span><b>+1,861만 원</b><i>무료 가입 월 100명 → 6개월 차 5,133명, 이후 매달 2%% 증가 기준</i></div>
    </div>
  </div>
  <div class="ft"><b>RE:ADD</b><span>16</span></div>
</section>
''' % (c1, c2)
s = open(p, encoding='utf-8').read()
a = s.index('<!-- 15-2.'); b = s.index('</section>', a) + len('</section>\n')
s = s[:a] + sec + s[b:]
s = re.sub(r'\.flow2 [^\n]*\n', '', s)
css = '.flow2 .two{display:flex;gap:30px}.flow2 .two>div{flex:1;background:#fcfaf5;padding:12px 0 0}.flow2 .two .lb{padding:0 14px}.flow2 .stats{display:flex;gap:30px;margin-top:16px}.flow2 .stats>div{flex:1;border-top:3px solid #1c2233;padding-top:8px}.flow2 .stats span{display:block;font-size:13px;font-weight:700;color:#a8432f}.flow2 .stats b{display:block;font-family:\'Noto Serif CJK KR\',\'Noto Serif KR\',serif;font-size:24px;line-height:32px;color:#1c2233}.flow2 .stats i{display:block;font-style:normal;font-size:13px;line-height:19px;color:#1c2233}\n</style>'
s = s.replace('</style>', css, 1)
open(p, 'w', encoding='utf-8').write(s)
print('ok')
