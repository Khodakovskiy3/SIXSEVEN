#!/usr/bin/env python3
"""
OLIMP Analytics PDF Generator
Читає JSON з stdin, генерує PDF у stdout.

Запуск:
    echo '<json>' | python3 scripts/gen_pdf_report.py > report.pdf
"""

import sys
import os
import json
from io import BytesIO
from datetime import datetime

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import HexColor, white
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
except ImportError:
    sys.stderr.write('reportlab not installed: pip install reportlab\n')
    sys.exit(1)

# Register DejaVu Sans (Cyrillic support)
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_FONTS_DIR  = os.path.join(_SCRIPT_DIR, 'fonts')
_FONT_REG   = os.path.join(_FONTS_DIR, 'DejaVuSans.ttf')
_FONT_BOLD  = os.path.join(_FONTS_DIR, 'DejaVuSans-Bold.ttf')

if os.path.exists(_FONT_REG) and os.path.exists(_FONT_BOLD):
    pdfmetrics.registerFont(TTFont('DVS',     _FONT_REG))
    pdfmetrics.registerFont(TTFont('DVS-Bold', _FONT_BOLD))
    FONT      = 'DVS'
    FONT_BOLD = 'DVS-Bold'
else:
    # Fallback to Helvetica (no Cyrillic, but won't crash)
    FONT      = 'Helvetica'
    FONT_BOLD = 'Helvetica-Bold'

data = json.loads(sys.stdin.read())

W, H = A4
PAD = 36

ACCENT   = HexColor('#E85002')
BG       = HexColor('#FFFFFF')
SURFACE  = HexColor('#F5F5F5')
SURFACE2 = HexColor('#EEEEEE')
TEXT     = HexColor('#111111')
MUTED    = HexColor('#666666')
LINE     = HexColor('#DDDDDD')
GREEN    = HexColor('#16A34A')
ORANGE2  = HexColor('#F97316')
BLUE     = HexColor('#3B82F6')
PURPLE   = HexColor('#8B5CF6')

# ── helpers ──────────────────────────────────────────────────────────────────

def draw_rect(c, x, y, w, h, color, radius=6):
    c.setFillColor(color)
    if radius:
        c.roundRect(x, y, w, h, radius, stroke=0, fill=1)
    else:
        c.rect(x, y, w, h, stroke=0, fill=1)

def draw_border_rect(c, x, y, w, h, fill_color=BG, stroke_color=LINE, radius=6):
    c.setFillColor(fill_color)
    c.setStrokeColor(stroke_color)
    c.setLineWidth(0.5)
    c.roundRect(x, y, w, h, radius, stroke=1, fill=1)

def draw_hbar(c, x, y, total_w, pct, bar_h=7):
    draw_rect(c, x, y, total_w, bar_h, LINE, radius=3)
    if pct > 0:
        draw_rect(c, x, y, max(total_w * pct / 100, bar_h), bar_h, ACCENT, radius=3)

def draw_sparkline(c, x, y, width, height, values):
    if len(values) < 2:
        return
    mn, mx = min(values), max(values)
    rng = mx - mn or 1
    pts = [(x + i * width / (len(values)-1), y + (v - mn) / rng * height)
           for i, v in enumerate(values)]
    # fill
    p = c.beginPath()
    p.moveTo(pts[0][0], y)
    for px, py in pts:
        p.lineTo(px, py)
    p.lineTo(pts[-1][0], y)
    p.close()
    c.setFillColor(ACCENT)
    c.setFillAlpha(0.10)
    c.drawPath(p, stroke=0, fill=1)
    c.setFillAlpha(1)
    # line
    c.setStrokeColor(ACCENT)
    c.setLineWidth(2)
    p = c.beginPath()
    p.moveTo(*pts[0])
    for pt in pts[1:]:
        p.lineTo(*pt)
    c.drawPath(p, stroke=1, fill=0)
    # dots
    c.setFillColor(ACCENT)
    for px, py in pts:
        c.circle(px, py, 3, stroke=0, fill=1)

def draw_bar_chart(c, x, y, width, height, data_items):
    if not data_items:
        return
    maxv = max(v for _, v in data_items) or 1
    bar_w = (width - (len(data_items)-1)*5) / len(data_items)
    for i, (lbl, val) in enumerate(data_items):
        bx = x + i * (bar_w + 5)
        bh = (val / maxv) * height
        draw_rect(c, bx, y, bar_w, height, SURFACE2, radius=3)
        draw_rect(c, bx, y, bar_w, max(bh, 2), ACCENT, radius=3)
        c.setFillColor(MUTED)
        c.setFont(FONT, 6)
        c.drawCentredString(bx + bar_w/2, y - 10, str(lbl))
        if val > 0:
            c.setFillColor(TEXT)
            c.setFont(FONT_BOLD, 6.5)
            c.drawCentredString(bx + bar_w/2, y + bh + 2, str(val))

def metric_card(c, x, y, w, h, lbl, value, sub='', accent=False):
    if accent:
        draw_rect(c, x, y, w, h, ACCENT, radius=8)
        lc = HexColor('#FFFFFF99')
        vc = white
        sc = white
    else:
        draw_border_rect(c, x, y, w, h, BG, LINE, radius=8)
        lc, vc, sc = MUTED, TEXT, MUTED
    c.setFillColor(lc)
    c.setFont(FONT, 7.5)
    c.drawString(x+10, y+h-16, lbl)
    c.setFillColor(vc)
    # Auto-fit: reduce font size if value is long
    val_font = 14 if len(value) <= 10 else 11
    c.setFont(FONT_BOLD, val_font)
    c.drawString(x+10, y+h-34, value)
    if sub:
        c.setFillColor(sc)
        c.setFont(FONT, 7)
        c.drawString(x+10, y+8, sub)

def section_heading(c, text, y):
    draw_rect(c, PAD, y+2, 3, 13, ACCENT, radius=0)
    c.setFillColor(TEXT)
    c.setFont(FONT_BOLD, 11)
    c.drawString(PAD+10, y+3, text)

def fmt_money(v):
    v = int(round(v))
    return f"{v:,}".replace(',', ' ') + ' грн'

def fmt_date(d):
    """'2025-06-01' → '01.06.2025'"""
    try:
        dt = datetime.strptime(str(d)[:10], '%Y-%m-%d')
        return dt.strftime('%d.%m.%Y')
    except Exception:
        return str(d)[:10]

# ── extract data ──────────────────────────────────────────────────────────────
period    = data.get('period', {})
summary   = data.get('summary', {})
rev_days  = data.get('revenueByDay', [])
vis_days  = data.get('visitsByDay', [])
trainers  = data.get('trainerLoad', [])
plans     = data.get('planStats', [])
workouts  = data.get('workoutStats', [])
prev      = data.get('prevPeriod', {})

start_lbl = fmt_date(period.get('start', ''))
end_lbl   = fmt_date(period.get('end', ''))
period_lbl = f"{start_lbl} — {end_lbl}"

revenue       = summary.get('revenue', 0)
visits_count  = summary.get('visits_count', 0)
active_subs   = summary.get('active_subscriptions', 0)
total_clients = summary.get('total_clients', 0)
avg_payment   = summary.get('average_payment', 0)
payments_cnt  = summary.get('payments_count', 0)

prev_revenue      = prev.get('revenue', 0)
prev_visits       = prev.get('visits_count', 0)
prev_payments_cnt = prev.get('payments_count', 0)
prev_start_lbl    = fmt_date(prev.get('start', ''))
prev_end_lbl      = fmt_date(prev.get('end', ''))
has_prev          = bool(prev.get('start'))

def trend_str(curr, prev_val):
    """Returns e.g. '+12%' / '-5%' / '—'"""
    if not prev_val:
        return '—'
    pct = round((curr - prev_val) / prev_val * 100)
    return ('+' if pct >= 0 else '') + str(pct) + '%'

def trend_color(curr, prev_val):
    if not prev_val:
        return MUTED
    return GREEN if curr >= prev_val else HexColor('#DC2626')

# ── build PDF ─────────────────────────────────────────────────────────────────
buf = BytesIO()
c = canvas.Canvas(buf, pagesize=A4)
c.setTitle('OLIMP — Аналітичний звіт')

draw_rect(c, 0, 0, W, H, BG, radius=0)

# HEADER
draw_rect(c, 0, H-72, W, 72, SURFACE, radius=0)
draw_rect(c, 0, H-72, W, 0.5, LINE, radius=0)
draw_rect(c, 0, H-72, 4, 72, ACCENT, radius=0)

c.setFillColor(TEXT)
c.setFont(FONT_BOLD, 22)
c.drawString(PAD+12, H-40, 'OLIMP')
c.setFillColor(ACCENT)
c.setFont(FONT_BOLD, 8)
c.drawString(PAD+12, H-54, 'FITNESS CLUB')

c.setFillColor(MUTED)
c.setFont(FONT, 9)
now_str = datetime.now().strftime('%d.%m.%Y %H:%M')
c.drawRightString(W-PAD, H-36, f'Звіт сформовано: {now_str}')
c.setFillColor(TEXT)
c.setFont(FONT_BOLD, 13)
c.drawRightString(W-PAD, H-52, f'Аналітика: {period_lbl}')

# KPI ROW
y = H - 82
kpi_w = (W - 2*PAD - 3*10) / 4

new_clients = summary.get('total_clients', 0)
kpis = [
    ('Дохід за період',   fmt_money(revenue),    f'{payments_cnt} оплат',   True),
    ('Відвідувань',       str(visits_count),      'за вибраний період',      False),
    ('Активних абон.',    str(active_subs),       f'з {total_clients} клієнтів', False),
    ('Середній чек',      fmt_money(avg_payment), 'за оплату',               False),
]
for i, (lbl, val, sub, acc) in enumerate(kpis):
    metric_card(c, PAD + i*(kpi_w+10), y-66, kpi_w, 66, lbl, val, sub, accent=acc)

# Comparison row (previous period)
if has_prev:
    cy = y - 66 - 14
    draw_border_rect(c, PAD, cy-18, W-2*PAD, 18, SURFACE, LINE, radius=5)
    # Label
    c.setFillColor(MUTED)
    c.setFont(FONT, 7)
    c.drawString(PAD+10, cy-12, f'Порівняно з попереднім: {prev_start_lbl} — {prev_end_lbl}')
    # Trend values for each KPI
    trends = [
        ('Дохід',       revenue,       prev_revenue,      fmt_money(prev_revenue)),
        ('Відвідувань', visits_count,  prev_visits,       str(prev_visits)),
        ('Оплат',       payments_cnt,  prev_payments_cnt, str(prev_payments_cnt)),
    ]
    tx_start = PAD + 160
    for j, (tlbl, curr_v, prev_v, prev_fmt) in enumerate(trends):
        tx = tx_start + j * 130
        c.setFillColor(MUTED)
        c.setFont(FONT, 6.5)
        c.drawString(tx, cy-12, f'{tlbl}: {prev_fmt}  ')
        ts = trend_str(curr_v, prev_v)
        tc = trend_color(curr_v, prev_v)
        c.setFillColor(tc)
        c.setFont(FONT_BOLD, 7)
        c.drawString(tx + 85, cy-12, ts)
    y = cy - 18
else:
    y = y - 66

# ── SECTION 1: ФІНАНСИ ───────────────────────────────────────────────────────
y = y - 24
section_heading(c, 'ФІНАНСИ — ДОХІД ЗА ПЕРІОД', y)
y -= 18

chart_h = 78
# limit to 14 points max for readability
rev_vals_all = [r['revenue'] for r in rev_days]
step = max(1, len(rev_vals_all) // 14)
rev_vals = rev_vals_all[::step]
if not rev_vals:
    rev_vals = [0, 0]

chart_w = W - 2*PAD - 160
draw_border_rect(c, PAD, y-chart_h-6, chart_w, chart_h+16, BG, LINE, radius=8)
draw_sparkline(c, PAD+12, y-chart_h+4, chart_w-24, chart_h-16, rev_vals)

# x-axis dates
total_days = len(rev_vals)
label_step = max(1, total_days // 6)
for i in range(0, total_days, label_step):
    mx = PAD+12 + i*(chart_w-24)/(max(total_days-1, 1))
    c.setFillColor(MUTED)
    c.setFont(FONT, 6)
    date_str = rev_days[i * step]['date'] if i*step < len(rev_days) else ''
    c.drawCentredString(mx, y-chart_h-4, fmt_date(date_str)[0:5])

# Finance breakdown
bx = PAD + chart_w + 14
bw = W - PAD - bx
total_plan_rev = sum(p.get('revenue', 0) for p in plans)
one_time_rev = revenue - total_plan_rev if revenue > total_plan_rev else 0
fdata = [
    ('Абонементи',     fmt_money(total_plan_rev),
     f"{int(total_plan_rev/revenue*100) if revenue else 0}%"),
    ('Разові послуги', fmt_money(one_time_rev),
     f"{int(one_time_rev/revenue*100) if revenue else 0}%"),
    ('Середній чек',   fmt_money(avg_payment),  f'{payments_cnt} оплат'),
]
bh_card = (chart_h + 16) / 4
for i, (lbl, val, pct) in enumerate(fdata):
    by = y - chart_h - 6 + (len(fdata)-1-i)*bh_card
    ch = bh_card - 3
    draw_border_rect(c, bx, by+2, bw, ch, SURFACE, LINE, radius=5)
    # label top, value bottom — fixed offsets within card
    c.setFillColor(MUTED)
    c.setFont(FONT, 6.5)
    c.drawString(bx+8, by+ch-3, lbl)
    c.setFillColor(TEXT)
    c.setFont(FONT_BOLD, 8)
    c.drawString(bx+8, by+5, val)
    c.setFillColor(ACCENT)
    c.setFont(FONT_BOLD, 6.5)
    c.drawRightString(bx+bw-8, by+5, pct)

y = y - chart_h - 6 - 24

# ── SECTION 2: ВІДВІДУВАНІСТЬ ─────────────────────────────────────────────────
section_heading(c, 'ВІДВІДУВАНІСТЬ', y)
y -= 18

vis_vals_all = [r['visits_count'] for r in vis_days]
vis_labels_all = [fmt_date(r['date'])[0:5] for r in vis_days]
# limit to 14
step2 = max(1, len(vis_vals_all) // 14)
vis_vals = vis_vals_all[::step2]
vis_labels = vis_labels_all[::step2]

bar_area_w = (W - 2*PAD) * 0.60
bar_area_h = 68
draw_border_rect(c, PAD, y-bar_area_h-6, bar_area_w, bar_area_h+16, BG, LINE, radius=8)
draw_bar_chart(c, PAD+14, y-bar_area_h+10, bar_area_w-28, bar_area_h-22,
               list(zip(vis_labels, vis_vals)))

# Visit type: workouts
vx = PAD + bar_area_w + 14
vw = W - PAD - vx
wdata = workouts[:4] if workouts else []
max_b = max((w.get('bookings_count', 0) for w in wdata), default=1) or 1
for i, w_item in enumerate(wdata):
    vy = y - 6 - i*20
    name = w_item.get('workout_name', '')[:18]
    cnt  = w_item.get('bookings_count', 0)
    pct  = int(cnt / max_b * 100)
    c.setFillColor(MUTED)
    c.setFont(FONT, 7.5)
    c.drawString(vx, vy, name)
    draw_hbar(c, vx, vy-10, vw-30, pct, bar_h=6)
    c.setFillColor(TEXT)
    c.setFont(FONT_BOLD, 7.5)
    c.drawRightString(vx+vw-2, vy-9, str(cnt))

y = y - bar_area_h - 6 - 24

# ── SECTION 3: АБОНЕМЕНТИ ────────────────────────────────────────────────────
section_heading(c, 'АБОНЕМЕНТИ', y)
y -= 18

plan_colors = [ACCENT, ORANGE2, BLUE, PURPLE, GREEN]
top_plans = plans[:5] if plans else []
total_subs = sum(p.get('subscriptions_count', 0) for p in top_plans) or 1

card_h = 20 + len(top_plans) * 18 + 20
draw_border_rect(c, PAD, y-card_h, W-2*PAD, card_h, BG, LINE, radius=8)

# Segmented bar
seg_x = PAD+14
seg_w = W-2*PAD-28
seg_y2 = y-16
for i, p_item in enumerate(top_plans):
    cnt = p_item.get('subscriptions_count', 0)
    sw = seg_w * cnt / total_subs if total_subs else 0
    draw_rect(c, seg_x, seg_y2, max(sw-2, 1), 10, plan_colors[i % len(plan_colors)], radius=3)
    seg_x += sw

# Legend rows
for i, p_item in enumerate(top_plans):
    lx = PAD+14
    ly = seg_y2 - 18 - i*17
    col = plan_colors[i % len(plan_colors)]
    draw_rect(c, lx, ly+2, 9, 9, col, radius=2)
    c.setFillColor(MUTED)
    c.setFont(FONT, 8)
    c.drawString(lx+14, ly+3, p_item.get('plan_name', '')[:45])
    c.setFillColor(TEXT)
    c.setFont(FONT_BOLD, 8)
    c.drawRightString(W-PAD-14, ly+3, str(p_item.get('subscriptions_count', 0)))

y = y - card_h - 24

# ── SECTION 4: ТРЕНЕРИ ───────────────────────────────────────────────────────
section_heading(c, 'ТРЕНЕРИ', y)
y -= 18

t_card_h = 20 + len(trainers[:4]) * 22 + 8
draw_border_rect(c, PAD, y-t_card_h, W-2*PAD, t_card_h, BG, LINE, radius=8)
max_sess = max((t.get('sessions_count', 0) for t in trainers), default=1) or 1

for i, t_item in enumerate(trainers[:4]):
    ty = y - 20 - i*22
    name  = t_item.get('trainer_name', '')
    sess  = t_item.get('sessions_count', 0)
    books = t_item.get('bookings_count', 0)
    pct   = int(sess / max_sess * 100)
    bar_x = PAD+14+290
    bar_total = W-2*PAD-310
    c.setFillColor(TEXT)
    c.setFont(FONT_BOLD, 9)
    c.drawString(PAD+14, ty, name)
    c.setFillColor(MUTED)
    c.setFont(FONT, 8)
    c.drawString(PAD+14+140, ty, f'{sess} занять')
    c.drawString(PAD+14+210, ty, f'{books} записів')
    draw_hbar(c, bar_x, ty-2, bar_total, pct)
    c.setFillColor(ACCENT)
    c.setFont(FONT_BOLD, 7.5)
    pct_y = ty + 8 if pct >= 95 else ty
    c.drawRightString(W-PAD-14, pct_y, f'{pct}%')

# ── FOOTER ───────────────────────────────────────────────────────────────────
draw_rect(c, 0, 0, W, 30, SURFACE, radius=0)
draw_rect(c, 0, 28, W, 0.5, LINE, radius=0)
draw_rect(c, 0, 0, W, 2, ACCENT, radius=0)
c.setFillColor(MUTED)
c.setFont(FONT, 7.5)
c.drawString(PAD, 10, 'OLIMP Fitness Club · вул. Спортивна, 10, Київ · info@olimp.ua')
c.drawRightString(W-PAD, 10, 'Конфіденційно · Сторінка 1 з 1')

c.save()
sys.stdout.buffer.write(buf.getvalue())
