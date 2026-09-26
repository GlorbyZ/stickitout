import math, random
random.seed(220)
W=512
def stick(butt, tip, gid):
    bx,by=butt; tx,ty=tip
    ang=math.degrees(math.atan2(ty-by, tx-bx)); L=math.hypot(tx-bx, ty-by)
    # local: x along axis from 0 (butt) to L (bead centre)
    sh=L-78; nk=L-30
    body=(f"M0,-23 L{sh*0.62:.1f},-22 L{sh:.1f},-17 C{sh+18:.1f},-16 {nk-6:.1f},-9 {nk:.1f},-8 "
          f"L{nk:.1f},8 C{nk-6:.1f},9 {sh+18:.1f},16 {sh:.1f},17 L{sh*0.62:.1f},22 L0,23 A23,23 0 0 1 0,-23 Z")
    # molten crack: jagged line along the stick
    pts=[(10,0)]
    x=10
    while x<nk-8:
        x+=random.uniform(18,34); pts.append((min(x,nk-8), random.uniform(-10,10)))
    crack=" ".join(f"{a:.1f},{b:.1f}" for a,b in pts)
    branches=""
    for i in range(1,len(pts)-1,2):
        a,b=pts[i]; bl=random.uniform(8,14)*random.choice([-1,1])
        branches+=f'<polyline points="{a:.1f},{b:.1f} {a+random.uniform(6,12):.1f},{b+bl:.1f}" />'
    return f'''<g transform="translate({bx},{by}) rotate({ang:.3f})">
      <path d="{body}" fill="url(#obsidian)" stroke="url(#rim)" stroke-width="7" stroke-linejoin="round"/>
      <ellipse cx="{L:.1f}" cy="0" rx="34" ry="25" fill="url(#obsidian)" stroke="url(#rim)" stroke-width="7"/>
      <g fill="none" stroke="#ffcf4a" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" filter="url(#soft)">
        <polyline points="{crack}"/>{branches}
      </g>
      <g fill="none" stroke="#fff4c7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="{crack}"/>{branches}
      </g>
      <path d="M8,-12 L{sh*0.6:.1f},-11" stroke="#fff0c2" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="{L-8:.1f}" cy="-9" rx="10" ry="4" fill="#fff0c2" opacity="0.35"/>
    </g>'''

rays=""
for i in range(28):
    a=i*(360/28)+random.uniform(-3,3)
    long_=random.uniform(150,238) if i%2==0 else random.uniform(110,170)
    w=random.uniform(7,13)
    rays+=f'<path d="M0,{-w} L{long_:.1f},0 L0,{w} Z" transform="rotate({a:.2f})" />'
sparks=""
for i in range(70):
    r=random.uniform(60,240); a=random.uniform(0,2*math.pi)
    x=256+r*math.cos(a); y=256+r*math.sin(a)
    s=random.choice([1.2,1.6,2.2,2.8,3.6])
    col=random.choice(["#fff4c7","#ffcf4a","#e8a317","#ff5a36"])
    sparks+=f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{s}" fill="{col}"/>'
stars=""
for (x,y,s) in [(96,120,16),(410,300,13),(150,395,12),(372,170,10),(256,70,14),(70,270,10),(445,420,11),(300,455,9)]:
    stars+=f'<path d="M{x},{y-s} L{x+s*0.22},{y-s*0.22} L{x+s},{y} L{x+s*0.22},{y+s*0.22} L{x},{y+s} L{x-s*0.22},{y+s*0.22} L{x-s},{y} L{x-s*0.22},{y-s*0.22} Z" fill="#fff4c7"/>'
bolt=lambda pts: " ".join(f"{a},{b}" for a,b in pts)
arcs=[ [(256,256),(232,214),(248,196),(214,150),(226,138),(196,96)],
       [(256,256),(292,236),(300,252),(346,228),(356,242),(404,222)],
       [(256,256),(270,300),(252,312),(276,352),(262,364),(284,410)],
       [(256,256),(214,270),(204,254),(160,280),(150,266),(104,284)] ]
arcsvg="".join(f'<polyline points="{bolt(p)}"/>' for p in arcs)
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Insanity medal</title>
  <defs>
    <linearGradient id="obsidian" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#3a302a"/><stop offset="0.45" stop-color="#15110f"/><stop offset="1" stop-color="#050404"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff0b8"/><stop offset="0.4" stop-color="#f2b631"/><stop offset="1" stop-color="#b8740c"/>
    </linearGradient>
    <radialGradient id="core" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fffbe6" stop-opacity="1"/><stop offset="0.18" stop-color="#ffd35c" stop-opacity="0.95"/>
      <stop offset="0.4" stop-color="#e8561c" stop-opacity="0.45"/><stop offset="0.7" stop-color="#9c0f2e" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#9c0f2e" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="rayfade" cx="0" cy="0" r="240" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffe08a" stop-opacity="0.95"/><stop offset="0.5" stop-color="#e8a317" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#c2261a" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="7" result="b"/>
      <feFlood flood-color="#ffb321" flood-opacity="0.9"/><feComposite in2="b" operator="in" result="g"/>
      <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="blur6"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <circle cx="256" cy="256" r="236" fill="url(#core)"/>
  <g transform="translate(256,256)" fill="url(#rayfade)" opacity="0.75">{rays}</g>
  <g fill="none" stroke="#e8a317" stroke-width="4" opacity="0.8">
    <circle cx="256" cy="256" r="218" stroke-dasharray="46 14"/>
  </g>
  <circle cx="256" cy="256" r="200" fill="none" stroke="#ff5a36" stroke-width="1.5" opacity="0.5"/>
  <g>{sparks}</g>
  <g opacity="0.95">{stars}</g>
  <g filter="url(#glow)">
    {stick((84,430),(422,92),"a")}
    {stick((428,430),(90,92),"b")}
  </g>
  <g fill="none" stroke="#ffe7a0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.6" filter="url(#blur6)">{arcsvg}</g>
  <g fill="none" stroke="#fffbe6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">{arcsvg}</g>
  <circle cx="256" cy="256" r="30" fill="#fffbe6" opacity="0.85" filter="url(#blur6)"/>
  <circle cx="256" cy="256" r="11" fill="#ffffff"/>
</svg>'''
open("medal-insanity.svg","w").write(svg)
print(len(svg))
