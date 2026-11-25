"""RE:ADD 사업계획서 재무 모델 (덱 버전 44, 2026-11-25 기준).

python3 readd_model.py            -> 덱 15~18쪽 숫자 전부 출력
python3 readd_model.py --book 77  -> 권당 AI 비용만 바꿔 다시 계산

가정을 바꾸려면 아래 ASSUME 값을 고친다. 덱 숫자와 반올림 안에서 일치해야 한다.
"""
import argparse

ASSUME = dict(
    price_basic=3900, price_premium=5400, premium_share=0.20,  # 상위 요금제 비중 (가정)
    app_fee=0.15,                 # 앱스토어 수수료, 부가세 뺀 금액 기준
    publisher_share=0.60,         # 출판사: 이달의 작품 = 기본 순매출의 60%
    prev_season_pool=0.50,        # 상위 추가 순매출 - 추가 AI 비용의 50% = 이전 시즌 정산 (엑셀 식)
    book_ai=46,                   # 권당 AI 비용(원): 질문 25개 x 1.71 + 리캡 3회 x 1.23 (4권 측정 중앙값)
    books_basic=3, books_premium=8,
    labor=2236300,                # 2027 최저임금 10,700 x 209h
    fixed_other=363545,           # 관계 추출 14만 + AWS 약 19.7만 + 앱스토어·도메인 1.2만 + 작품 생성 810 + 커뮤니티 1.4만
    init_cost=535000, prelaunch_months=2,
    conv=0.20, ren1=0.775, ret12=0.095,
    ramp=[100, 300, 700, 1500, 3000, 5133], growth_after=0.02,  # 무료 가입: 성장 경로 C
)


def unit(a):
    vb = a['price_basic'] / 11; fb = (a['price_basic'] - vb) * a['app_fee']; nb = a['price_basic'] - vb - fb
    pub = nb * a['publisher_share']; aib = a['books_basic'] * a['book_ai']; wb = nb - pub - aib
    vp = a['price_premium'] / 11; fp = (a['price_premium'] - vp) * a['app_fee']; npm = a['price_premium'] - vp - fp
    aip = a['books_premium'] * a['book_ai']
    pool = max(0, (npm - nb - (aip - aib)) * a['prev_season_pool'])
    wp = npm - pub - pool - aip
    w = (1 - a['premium_share']) * wb + a['premium_share'] * wp
    return dict(vb=vb, fb=fb, nb=nb, pub=pub, aib=aib, wb=wb, vp=vp, fp=fp, npm=npm, pool=pool, aip=aip, wp=wp, w=w)


def signups(a, t):
    if t < 1:
        return 0
    r = a['ramp']
    return r[t - 1] if t <= len(r) else r[-1] * (1 + a['growth_after']) ** (t - len(r))


def simulate(a, n=60, labor=None):
    u = unit(a); lab = a['labor'] if labor is None else labor
    fixed = a['fixed_other'] + lab
    churn = 1 - (a['ret12'] / a['ren1']) ** (1 / 10)
    cum = -(a['prelaunch_months'] * fixed + a['init_cost']); pre = -cum; low, lowt = cum, 0
    J = [0] * (n + 1); K = [0] * (n + 1); rows = []
    for t in range(1, n + 1):
        J[t] = signups(a, t - 1) * a['conv']
        K[t] = K[t - 1] * (1 - churn) + J[t - 1] * a['ren1']
        paid = J[t] + K[t]
        pl = paid * u['w'] - signups(a, t) * u['aib'] - fixed
        cum += pl
        if cum < low:
            low, lowt = cum, t
        rows.append(dict(t=t, sig=signups(a, t), paid=paid, pl=pl, cum=cum,
                         bep=(fixed + signups(a, t) * u['aib']) / u['w']))
    be = next(r['t'] for r in rows if r['pl'] >= 0)
    rc = next((r['t'] for r in rows if r['cum'] >= 0), None)
    return dict(rows=rows, be=be, rc=rc, need=-low, lowt=lowt, pre=pre, fixed=fixed, u=u, churn=churn)


def ym(t):
    return '%d-%02d' % (2026 + (t + 10) // 12, (t + 10) % 12 + 1)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--book', type=float)
    args = ap.parse_args()
    a = dict(ASSUME)
    if args.book is not None:
        a['book_ai'] = args.book
    s = simulate(a); u = s['u']; R = s['rows']
    print('== 1명당 (14쪽 BM, 18쪽)')
    print('기본: 부가세 %.0f 수수료 %.0f 출판사 %.0f AI %.0f -> RE:ADD %.1f' % (u['vb'], u['fb'], u['pub'], u['aib'], u['wb']))
    print('상위: 부가세 %.0f 수수료 %.0f 출판사 %.0f 이전시즌 %.0f AI %.0f -> RE:ADD %.1f' % (u['vp'], u['fp'], u['pub'], u['pool'], u['aip'], u['wp']))
    print('평균 %.1f원 / 상위 출판사 몫 비율 %.1f%%' % (u['w'], (u['pub'] + u['pool']) / u['npm'] * 100))
    b = R[s['be'] - 1]
    print('== 15·16쪽')
    print('월 고정비 %.0f / BEP %d개월 차(%s) BEP 구독자 %.0f명, 그달 유료 %.0f명, 체험자 AI %.0f만' % (
        s['fixed'], s['be'], ym(s['be']), b['bep'], b['paid'], b['sig'] * u['aib'] / 1e4))
    print('필요 자금 %.0f만 (출시 전 %.0f + 운영 적자 %.0f, 최저 %d개월 차) / 회수 %s개월 차(%s)' % (
        s['need'] / 1e4, s['pre'] / 1e4, (s['need'] - s['pre']) / 1e4, s['lowt'], s['rc'], ym(s['rc']) if s['rc'] else '-'))
    z = simulate(a, labor=0); zb = z['rows'][z['be'] - 1]
    print('인건비 제외: BEP %d개월 차(%s) %.0f명, 필요 %.0f만, 회수 %s개월 차' % (z['be'], ym(z['be']), zb['bep'], z['need'] / 1e4, z['rc']))
    print('== 17쪽 분기 (분기말 유료, 매출 만원)')
    for q in range(8):
        Q = R[q * 3:q * 3 + 3]
        print('Q%d %6.0f %7.0f' % (q + 1, Q[-1]['paid'], sum(x['paid'] for x in Q) * 4200 / 1e4))
    for y in (1, 2):
        Y = R[(y - 1) * 12:y * 12]; S = sum(x['paid'] for x in Y); T = sum(x['sig'] for x in Y); p = a['premium_share']
        rev = S * ((1 - p) * a['price_basic'] + p * a['price_premium'])
        fee = S * ((1 - p) * (u['vb'] + u['fb']) + p * (u['vp'] + u['fp']))
        pub = S * ((1 - p) * u['pub'] + p * (u['pub'] + u['pool']))
        ai = S * ((1 - p) * u['aib'] + p * u['aip']) + T * u['aib']
        fx = s['fixed'] * 12
        print('%d년 차: 매출 %.0f 수수료 -%.0f 출판사 -%.0f AI -%.0f 고정비 -%.0f = %+.0f만 / 연말 유료 %.0f' % (
            y, rev / 1e4, fee / 1e4, pub / 1e4, ai / 1e4, fx / 1e4, (rev - fee - pub - ai - fx) / 1e4, Y[-1]['paid']))
    print('3년 차 말 유료 %.0f명 / 3년 차 한 해 가입 %.0f명' % (R[35]['paid'], sum(x['sig'] for x in R[24:36])))
    print('체험자 1명 평생 몫 %.0f원 (마케팅비 상한 참고)' % (a['conv'] * (1 + a['ren1'] / s['churn']) * u['w'] - u['aib']))
    print('== 16쪽 그래프 (만원)')
    print('월손익', [round(r['pl'] / 1e4) for r in R[:24]])
    print('누적', [round(-s['pre'] / 1e4)] + [round(r['cum'] / 1e4) for r in R[:24]])


if __name__ == '__main__':
    main()
